import { open, rm } from 'fs/promises'
import { basename } from 'path'
import type { PushProgress, PushRequest, PushStepId } from '../shared/types'
import { isBetaVersion } from '../shared/version'
import { runChecks } from './checks'
import { commitAndPush, gitRoot, headCommit } from './git'
import { addHistory } from './history'
import { readManifestVersion, writeManifestVersion } from './manifest'
import { assetDetail, completeUpload, deleteVersion, startUpload, uploadChunk } from './portal'
import { updateConfig } from './store'
import { postUpdate } from './updates'
import { zipResource } from './zip'

const chunkSize = 2 * 1024 * 1024

class UpdatePostError extends Error {}
class PushCancelled extends Error {}
const processTimeout = 5 * 60 * 1000

export async function push(req: PushRequest, emit: (p: PushProgress) => void, cancelled: () => boolean): Promise<void> {
  const name = basename(req.scriptPath)
  const startedAt = Date.now()
  const stopIfCancelled = (): void => {
    if (cancelled()) throw new PushCancelled('Push cancelled.')
  }
  let current: PushStepId = 'manifest'
  const step = (id: PushStepId, status: PushProgress['status'], message?: string, progress?: number): void => {
    current = id
    emit({ step: id, status, message, progress })
  }

  let zipPath: string | null = null
  let before: string | null = null
  let zipInfo = { files: 0, size: 0 }
  // What a cancel has to clean up or report.
  let partialUpload: number | null = null
  let deletedVersion: string | null = null
  let live = false
  let wasCancelled = false
  let outcomeMessage: string | null = null
  try {
    // First, so a blocked push leaves the script untouched.
    step('zip', 'running', 'Checking for secrets')
    const blocked = (await runChecks(req.scriptPath)).secrets.filter((s) => s.sure && !s.allowed)
    if (blocked.length) throw new Error(`${blocked[0].kind} in ${blocked[0].file}, line ${blocked[0].line}. Remove it or allow it under Before upload.`)

    step('manifest', 'running')
    before = await readManifestVersion(req.scriptPath)
    if (before !== req.version) {
      await writeManifestVersion(req.scriptPath, req.version)
      step('manifest', 'done', `${before ?? 'none'} → ${req.version}`)
    } else {
      step('manifest', 'done', `${req.version} (unchanged)`)
    }

    stopIfCancelled()
    step('zip', 'running')
    const zip = await zipResource(req.scriptPath)
    zipPath = zip.path
    zipInfo = { files: zip.files, size: zip.size }
    step('zip', 'done', `${zip.files} files${zip.extras ? ` with ${zip.extras} extra ${zip.extras === 1 ? 'item' : 'items'}` : ''}, ${(zip.size / 1024 / 1024).toFixed(2)} MB`)

    stopIfCancelled()
    step('versions', 'running')
    const detail = await assetDetail(req.assetId)
    const versions = detail.versions ?? []
    const existing = versions.find((v) => v.version === req.version)
    if (existing && !req.replace) {
      throw new Error(`Version ${req.version} already exists on the portal for ${detail.name}`)
    }
    if (existing) {
      await deleteVersion(req.assetId, existing.id)
      deletedVersion = existing.version
      step('versions', 'done', `Deleted ${existing.version} to replace it`)
    } else if (versions.length >= 5) {
      const oldest = [...versions].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0]
      await deleteVersion(req.assetId, oldest.id)
      deletedVersion = oldest.version
      step('versions', 'done', `Deleted oldest version ${oldest.version}`)
    } else {
      step('versions', 'done', `${versions.length}/5 slots used`)
    }

    stopIfCancelled()
    step('upload', 'running', undefined, 0)
    const beta = isBetaVersion(req.version)
    const upload = await startUpload(
      req.assetId,
      { name: `${name}.zip`, size: zip.size, chunkSize },
      { version: req.version, changelog: req.changelog.trim() || `Version ${req.version}`, beta }
    )
    partialUpload = upload.versionId
    const total = Math.ceil(zip.size / chunkSize)
    const file = await open(zip.path, 'r')
    try {
      for (let i = 0; i < total; i++) {
        stopIfCancelled()
        const buf = Buffer.alloc(Math.min(chunkSize, zip.size - i * chunkSize))
        await file.read(buf, 0, buf.length, i * chunkSize)
        await uploadChunk(upload.assetId, upload.versionId, i, buf)
        step('upload', 'running', `Chunk ${i + 1}/${total}`, (i + 1) / total)
      }
    } finally {
      await file.close()
    }
    stopIfCancelled()
    await completeUpload(upload.assetId, upload.versionId)
    partialUpload = null
    step('upload', 'done', beta ? 'Uploaded as release candidate' : 'Uploaded', 1)

    step('process', 'running', 'Waiting for portal')
    const start = Date.now()
    for (;;) {
      const v = (await assetDetail(req.assetId)).versions.find((x) => x.id === upload.versionId)
      const state = v?.state ?? 'unknown'
      if (state === 'active') break
      if (/fail|error|reject|invalid/i.test(state)) throw new Error(`Portal processing failed (state: ${state})`)
      if (Date.now() - start > processTimeout) throw new Error(`Portal is still processing (state: ${state}). Check the portal later.`)
      step('process', 'running', `State: ${state}`)
      await new Promise((r) => setTimeout(r, 2000))
    }
    step('process', 'done', 'Active on portal')
    live = true

    const repo = await gitRoot(req.scriptPath)
    const head = repo ? await headCommit(repo) : null
    updateConfig((cfg) => {
      cfg.mappings[name] = { assetId: req.assetId, assetName: req.assetName }
      cfg.lastPush[name] = { version: req.version, commit: head, at: new Date().toISOString() }
      if (req.update?.package) cfg.packages[name] = req.update.package
      if (req.update?.discord || req.update?.apiAnnounce) cfg.update.roleId = req.update.roleId
      if (!repo) return
      if (req.git === cfg.gitDefault) delete cfg.git[name]
      else cfg.git[name] = req.git
    })

    // A failed update post must not stop the git step: the portal version is already live.
    let updateError: string | null = null
    if (req.update && (req.update.api || req.update.discord)) {
      step('update', 'running')
      try {
        step('update', 'done', await postUpdate(req.update, name, req.version, beta, (m) => step('update', 'running', m)))
      } catch (e) {
        updateError = e instanceof Error ? e.message : String(e)
        step('update', 'error', updateError)
      }
    } else {
      step('update', 'skipped')
    }

    if (req.git && repo) {
      step('git', 'running')
      const commit = await commitAndPush(repo, req.scriptPath, `${name} ${req.version}`, (m) => step('git', 'running', m))
      updateConfig((cfg) => {
        cfg.lastPush[name].commit = commit
      })
      step('git', 'done', 'Pushed')
    } else {
      step('git', 'skipped')
    }

    if (updateError) throw new UpdatePostError(`The version is live on the portal, but the update post failed. ${updateError}`)
  } catch (e) {
    if (e instanceof PushCancelled) {
      wasCancelled = true
      const notes = ['Push cancelled.']
      if (partialUpload !== null) {
        await deleteVersion(req.assetId, partialUpload).catch(() => notes.push('The unfinished upload could not be removed, so delete it on the portal.'))
      }
      if (before !== null && before !== req.version) await writeManifestVersion(req.scriptPath, before)
      if (deletedVersion) notes.push(`${deletedVersion} was already deleted from the portal.`)
      outcomeMessage = notes.join(' ')
      step(current, 'error', outcomeMessage)
      throw new PushCancelled(outcomeMessage)
    }
    outcomeMessage = e instanceof Error ? e.message : String(e)
    // The update step already shows its own error.
    if (!(e instanceof UpdatePostError)) step(current, 'error', outcomeMessage)
    throw e
  } finally {
    if (zipPath) await rm(zipPath, { force: true })
    addHistory(name, {
      at: new Date(startedAt).toISOString(),
      version: req.version,
      assetName: req.assetName,
      ...zipInfo,
      seconds: Math.round((Date.now() - startedAt) / 1000),
      replaced: req.replace,
      outcome: live ? 'live' : wasCancelled ? 'cancelled' : 'failed',
      message: outcomeMessage
    })
  }
}
