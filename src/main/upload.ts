import { open } from 'fs/promises'
import { assetDetail, completeUpload, startUpload, uploadChunk } from './portal'

const chunkSize = 2 * 1024 * 1024

interface UploadHooks {
  /** The portal made the version; from here a cancel has to delete it. */
  started: (versionId: number) => void
  progress: (done: number, total: number) => void
  /** Throws to cancel. */
  stop: () => void
}

/** Uploads a zip as a new version in 2 MB chunks. */
export async function uploadZip(
  assetId: number,
  zip: { path: string; size: number; name: string },
  meta: { version: string; changelog: string; beta: boolean },
  hooks: UploadHooks
): Promise<{ assetId: number; versionId: number }> {
  const upload = await startUpload(assetId, { name: zip.name, size: zip.size, chunkSize }, meta)
  hooks.started(upload.versionId)
  const total = Math.ceil(zip.size / chunkSize)
  const file = await open(zip.path, 'r')
  try {
    for (let i = 0; i < total; i++) {
      hooks.stop()
      const buf = Buffer.alloc(Math.min(chunkSize, zip.size - i * chunkSize))
      await file.read(buf, 0, buf.length, i * chunkSize)
      await uploadChunk(upload.assetId, upload.versionId, i, buf)
      hooks.progress(i + 1, total)
    }
  } finally {
    await file.close()
  }
  hooks.stop()
  await completeUpload(upload.assetId, upload.versionId)
  return upload
}

/** Polls the portal until it has processed the version. */
export async function waitUntilActive(assetId: number, versionId: number, timeout: number, onState: (state: string) => void, stop?: () => void): Promise<void> {
  const start = Date.now()
  for (;;) {
    stop?.()
    const v = (await assetDetail(assetId)).versions.find((x) => x.id === versionId)
    const state = v?.state ?? 'unknown'
    if (state === 'active') return
    if (/fail|error|reject|invalid/i.test(state)) throw new Error(`Portal processing failed (state: ${state})`)
    if (Date.now() - start > timeout) throw new Error(`Portal is still processing (state: ${state}). Check the portal later.`)
    onState(state)
    await new Promise((r) => setTimeout(r, 2000))
  }
}
