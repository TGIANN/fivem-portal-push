import { app } from 'electron'
import { existsSync, statSync } from 'fs'
import { rm } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { basename, join, parse, resolve } from 'path'
import type { EncryptJob, EncryptProgress, EncryptStepId } from '../shared/types'
import { encryptChangelog, pickRunVersion } from '../shared/version'
import { mirrorInto, pickPack } from './archive'
import { isInside } from './bundle'
import { scanSecrets } from './checks'
import { includedFiles } from './ignore'
import { assetDetail, deleteVersion, fetchToFile, packDownloadUrl } from './portal'
import { uploadZip, waitUntilActive } from './upload'
import { zipFiles } from './zip'

// A folder of 40+ scripts takes the portal much longer than one script.
const processTimeout = 45 * 60 * 1000

class Cancelled extends Error {}

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** The target is emptied on every run, so it can not be a folder that holds anything else of value. */
export function folderProblem(job: Pick<EncryptJob, 'source' | 'target'>): string | null {
  const source = job.source && resolve(job.source)
  const target = job.target && resolve(job.target)
  if (target) {
    if (parse(target).root === target) return 'The target can not be a whole drive.'
    for (const kept of [homedir(), app.getPath('userData'), app.getPath('desktop'), app.getPath('documents'), app.getPath('downloads')]) {
      if (isInside(target, kept)) return `The target can not be ${target}, because everything in it is replaced.`
    }
    if (source && (isInside(source, target) || isInside(target, source))) return 'The two folders can not be the same folder or sit inside each other.'
  }
  if (!source) return 'Pick the folder to encrypt.'
  if (!existsSync(source) || !statSync(source).isDirectory()) return `${source} does not exist.`
  if (!target) return 'Pick the folder the encrypted scripts go to.'
  return null
}

export function jobProblem(job: EncryptJob): string | null {
  const folders = folderProblem(job)
  if (folders) return folders
  if (!job.assetId) return 'Pick the portal asset to upload to.'
  return null
}

export async function runEncrypt(job: EncryptJob, emit: (p: EncryptProgress) => void, cancelled: () => boolean): Promise<{ message: string; version: string }> {
  const problem = jobProblem(job)
  if (problem) throw new Error(problem)
  const assetId = job.assetId!
  const source = resolve(job.source)
  const target = resolve(job.target)

  let current: EncryptStepId = 'scan'
  const step = (id: EncryptStepId, status: EncryptProgress['status'], message?: string, progress?: number): void => {
    current = id
    emit({ jobId: job.id, step: id, status, message, progress })
  }
  const stop = (): void => {
    if (cancelled()) throw new Cancelled('Cancelled.')
  }

  let zipPath: string | null = null
  let downloadPath: string | null = null
  let partialUpload: number | null = null
  let uploadedVersion = ''
  try {
    step('scan', 'running', 'Listing files')
    const files = await includedFiles(source)
    if (files.length === 0) throw new Error('No files to zip in the source folder.')
    const { secrets } = await scanSecrets(
      files.map((f) => ({ abs: f.abs, name: f.rel, own: true })),
      new Set()
    )
    const sure = secrets.filter((s) => s.sure)
    step(
      'scan',
      'done',
      sure.length
        ? `${sure.length} ${sure.length === 1 ? 'key or webhook' : 'keys or webhooks'} found, uploaded anyway: ${sure
            .slice(0, 3)
            .map((s) => `${s.kind} in ${s.file}:${s.line}`)
            .join(', ')}${sure.length > 3 ? ', …' : ''}`
        : `No keys or webhooks in ${files.length} files`
    )

    stop()
    step('zip', 'running')
    const zip = await zipFiles(files, basename(source))
    zipPath = zip.path
    step('zip', 'done', `${files.length} files, ${mb(zip.size)}`)

    stop()
    step('versions', 'running')
    const detail = await assetDetail(assetId)
    const plan = pickRunVersion(detail.versions ?? [])
    if ('error' in plan) throw new Error(plan.error)
    uploadedVersion = plan.version
    if (plan.replace) {
      await deleteVersion(assetId, plan.replace.id)
      step('versions', 'done', `Deleted ${uploadedVersion} to upload it again`)
    } else {
      step('versions', 'done', `Uploading as ${uploadedVersion}, a new version on ${detail.name}`)
    }

    stop()
    step('upload', 'running', undefined, 0)
    const upload = await uploadZip(
      assetId,
      { path: zip.path, size: zip.size, name: `${basename(source)}.zip` },
      { version: uploadedVersion, changelog: `${encryptChangelog}${basename(source)}`, beta: false },
      {
        started: (id) => (partialUpload = id),
        progress: (done, total) => step('upload', 'running', `Chunk ${done}/${total}`, done / total),
        stop
      }
    )
    partialUpload = null
    step('upload', 'done', mb(zip.size), 1)

    step('process', 'running', 'Waiting for the portal to encrypt the scripts')
    await waitUntilActive(assetId, upload.versionId, processTimeout, (state) => step('process', 'running', `State: ${state}`), stop)
    step('process', 'done', 'Active on portal')

    stop()
    step('download', 'running', undefined, 0)
    const version = (await assetDetail(assetId)).versions.find((v) => v.id === upload.versionId)
    const pack = pickPack(version?.packs)
    if (!pack) throw new Error('The portal shows no download for the new version.')
    const url = await packDownloadUrl('assets', assetId, upload.versionId, pack.id)
    downloadPath = join(tmpdir(), `${basename(source)}-encrypted-${Date.now()}.zip`)
    const size = await fetchToFile(
      url,
      downloadPath,
      (received, total) => step('download', 'running', total ? `${mb(received)} of ${mb(total)}` : mb(received), total ? received / total : undefined),
      cancelled
    )
    step('download', 'done', mb(size), 1)

    stop()
    step('extract', 'running')
    // Uploaded the way it is done by hand: the folder itself at the zip root.
    const count = await mirrorInto(downloadPath, target, basename(source))
    step('extract', 'done', `${count} files in ${target}`)
    return { message: `${basename(source)} is encrypted into ${basename(target)} as ${uploadedVersion}.`, version: uploadedVersion }
  } catch (e) {
    let message = e instanceof Error ? e.message : String(e)
    if (e instanceof Cancelled || /cancelled/i.test(message)) {
      message = 'Cancelled.'
      if (partialUpload !== null) {
        await deleteVersion(assetId, partialUpload).catch(() => (message += ' The unfinished upload could not be removed, so delete it on the portal.'))
      }
    }
    step(current, 'error', message)
    throw new Error(message)
  } finally {
    if (zipPath) await rm(zipPath, { force: true })
    if (downloadPath) await rm(downloadPath, { force: true })
  }
}
