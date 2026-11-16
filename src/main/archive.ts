import { createWriteStream, existsSync } from 'fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
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

// Far above any FiveM pack; a zip past either one is refused before it fills the disk.
const maxBytes = 8 * 1024 ** 3
const maxEntries = 200_000

/** Unpacks a zip into a folder. Entries that would land outside it stop the whole extract. */
export function extractZip(zipPath: string, dest: string): Promise<number> {
  return new Promise((done, fail) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return fail(err ?? new Error('Could not open the zip'))
      let files = 0
      let bytes = 0
      if (zip.entryCount > maxEntries) {
        zip.close()
        return fail(new Error(`The zip holds ${zip.entryCount} entries, more than the ${maxEntries} allowed.`))
      }
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
          // yauzl checks each entry against its declared size, so the sum can be trusted.
          bytes += entry.uncompressedSize
          if (bytes > maxBytes) throw new Error('The zip unpacks to more than 8 GB.')
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

// Which top-level names in a download folder each asset unpacked: exact name to asset key.
const ownersFile = '.portal-push-unzipped.json'
const tempPrefix = '.portal-unzip-'

async function readOwners(dir: string): Promise<Record<string, string>> {
  try {
    const data = JSON.parse(await readFile(join(dir, ownersFile), 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

/**
 * Unpacks a zip into a folder under the zip's own top-level names, since a FiveM folder name is the
 * resource name. The zip comes from the asset's author, so only a name this asset unpacked before is
 * replaced; anything else already there stays, and the new entry gets a " (2)" name beside it.
 */
export async function extractInto(zipPath: string, dir: string, owner: string): Promise<string[]> {
  const temp = join(dir, `${tempPrefix}${Date.now()}`)
  try {
    await extractZip(zipPath, temp)
    const owners = await readOwners(dir)
    const placed: string[] = []
    for (const name of await readdir(temp)) {
      // The app's own bookkeeping names are never taken from a zip.
      if (name.toLowerCase() === ownersFile || name.toLowerCase().startsWith(tempPrefix)) continue
      let final = name
      if (existsSync(join(dir, name))) {
        // Windows matches names without case, so the folder there may be spelled differently;
        // it is only replaced when it is exactly the name this asset placed.
        const exact = (await readdir(dir)).includes(name)
        if (exact && owners[name] === owner) await rm(join(dir, name), { recursive: true, force: true, maxRetries: 3 })
        else for (let n = 2; existsSync(join(dir, final)); n++) final = `${name} (${n})`
      }
      await rename(join(temp, name), join(dir, final))
      owners[final] = owner
      placed.push(final)
    }
    await writeFile(join(dir, ownersFile), JSON.stringify(owners, null, 2))
    return placed
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
  let keepOld = false
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
      if (targetMoved) {
        const restored = await rename(old, target).then(
          () => true,
          () => false
        )
        if (!restored) {
          keepOld = true
          throw new Error(`Could not swap in the new scripts or put the old ones back (${e instanceof Error ? e.message : String(e)}). The old scripts are in ${old}.`)
        }
      }
      throw e
    }
    return files
  } finally {
    if (!keepStaging) await rm(staging, { recursive: true, force: true })
    if (!keepOld) await rm(old, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
  }
}
