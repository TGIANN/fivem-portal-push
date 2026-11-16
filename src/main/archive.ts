import { createWriteStream } from 'fs'
import { mkdir, readdir, rename, rm } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import type { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import yauzl from 'yauzl'
import type { PortalPack } from '../shared/types'
import { isInside } from './bundle'

/** The FiveM pack of a version: one for both games first, then GTA V. */
export function pickPack(packs: PortalPack[] | undefined): PortalPack | null {
  const list = packs ?? []
  return list.find((p) => p.game === '') ?? list.find((p) => p.game === 'gta5') ?? list[0] ?? null
}

/** A name Windows accepts as a file or folder name. */
export function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim() || 'asset'
}

/** Unpacks a zip into a folder. Entries that would land outside it stop the whole extract. */
export function extractZip(zipPath: string, dest: string): Promise<number> {
  return new Promise((done, fail) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return fail(err ?? new Error('Could not open the zip'))
      let files = 0
      const stop = (e: unknown): void => {
        zip.close()
        fail(e)
      }
      zip.on('error', stop)
      zip.on('end', () => done(files))
      zip.on('entry', async (entry: yauzl.Entry) => {
        try {
          const out = resolve(dest, entry.fileName)
          if (out === resolve(dest) || !isInside(dest, out)) throw new Error(`The zip holds an unsafe path: ${entry.fileName}`)
          if (entry.fileName.endsWith('/')) {
            await mkdir(out, { recursive: true })
          } else {
            await mkdir(dirname(out), { recursive: true })
            const stream = await new Promise<Readable>((ok, no) => zip.openReadStream(entry, (e, s) => (e || !s ? no(e) : ok(s))))
            await pipeline(stream, createWriteStream(out))
            files++
          }
          zip.readEntry()
        } catch (e) {
          stop(e)
        }
      })
      zip.readEntry()
    })
  })
}

/** Unpacks a zip into a folder, replacing what is there under the same top-level names. */
export async function extractInto(zipPath: string, dir: string): Promise<string[]> {
  const temp = join(dir, `.portal-unzip-${Date.now()}`)
  try {
    await extractZip(zipPath, temp)
    const names = await readdir(temp)
    for (const name of names) {
      await rm(join(dir, name), { recursive: true, force: true, maxRetries: 3 })
      await rename(join(temp, name), join(dir, name))
    }
    return names
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

/**
 * Makes `target` hold exactly what the zip holds. The zip is unpacked next to the target first,
 * so a failed download or a broken zip never leaves the target half written.
 * When the zip holds nothing but a folder named `wrapper`, that folder's contents are used.
 */
export async function mirrorInto(zipPath: string, target: string, wrapper?: string): Promise<number> {
  const staging = `${target}.portal-new`
  const old = `${target}.portal-old`
  await rm(staging, { recursive: true, force: true })
  await rm(old, { recursive: true, force: true })
  let keepStaging = false
  try {
    const files = await extractZip(zipPath, staging)
    if (files === 0) throw new Error('The portal zip is empty, so the target folder was left as it was.')
    const top = await readdir(staging, { withFileTypes: true })
    const root = wrapper && top.length === 1 && top[0].isDirectory() && top[0].name === wrapper ? join(staging, wrapper) : staging

    let targetMoved = false
    try {
      await rename(target, old)
      targetMoved = true
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        // A running server can hold the folder itself open; swap what is inside instead.
        keepStaging = true
        try {
          await mkdir(target, { recursive: true })
          for (const name of await readdir(target)) await rm(join(target, name), { recursive: true, force: true, maxRetries: 3 })
          for (const name of await readdir(root)) await rename(join(root, name), join(target, name))
        } catch (err) {
          throw new Error(`Could not replace the contents of ${target} (${err instanceof Error ? err.message : String(err)}). Stop the server and copy the encrypted scripts from ${root} by hand.`)
        }
        keepStaging = false
        return files
      }
    }
    try {
      await rename(root, target)
    } catch (e) {
      if (targetMoved) await rename(old, target).catch(() => undefined)
      throw e
    }
    return files
  } finally {
    if (!keepStaging) await rm(staging, { recursive: true, force: true })
    await rm(old, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
  }
}
