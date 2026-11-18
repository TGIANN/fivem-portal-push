import { randomUUID } from 'crypto'
import { createWriteStream } from 'fs'
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

const writeOwners = (dir: string, owners: Record<string, string>): Promise<void> => writeFile(join(dir, ownersFile), JSON.stringify(owners, null, 2))

/** Windows matches names without case, so the entry already there may be spelled differently. */
async function onDisk(dir: string, name: string): Promise<string | undefined> {
  const lower = name.toLowerCase()
  return (await readdir(dir)).find((n) => n.toLowerCase() === lower)
}

/** Unpack folders a crashed or stopped run left behind. Only call it while no run is going. */
export async function removeStaleTemps(dir: string): Promise<void> {
  for (const name of await readdir(dir)) if (name.toLowerCase().startsWith(tempPrefix)) await rm(join(dir, name), { recursive: true, force: true }).catch(() => undefined)
}

export interface StagedConflict {
  /** The top-level name in the zip. */
  name: string
  /** How the name already there is spelled. */
  existing: string
  /** The same asset unpacked that exact name before. */
  sameAsset: boolean
}

/** A zip unpacked into a temp folder; the names in `conflicts` still wait there for the user. */
export interface Staged {
  temp: string
  owner: string
  placed: string[]
  conflicts: StagedConflict[]
}

/**
 * Unpacks a zip into a folder under the zip's own top-level names, since a FiveM folder name is the
 * resource name. Every free name is moved in at once; a name already taken stays in the temp folder,
 * and nothing there is touched until the user decides with `applyStaged`.
 */
export async function stageInto(zipPath: string, dir: string, owner: string): Promise<Staged> {
  const temp = join(dir, `${tempPrefix}${randomUUID()}`)
  try {
    await extractZip(zipPath, temp)
    const owners = await readOwners(dir)
    const placed: string[] = []
    const conflicts: StagedConflict[] = []
    for (const name of await readdir(temp)) {
      // The app's own bookkeeping names are never taken from a zip.
      if (name.toLowerCase() === ownersFile || name.toLowerCase().startsWith(tempPrefix)) continue
      const existing = await onDisk(dir, name)
      if (existing) {
        conflicts.push({ name, existing, sameAsset: existing === name && owners[name] === owner })
        continue
      }
      await rename(join(temp, name), join(dir, name))
      owners[name] = owner
      placed.push(name)
    }
    if (placed.length) await writeOwners(dir, owners)
    if (!conflicts.length) await rm(temp, { recursive: true, force: true })
    return { temp, owner, placed, conflicts }
  } catch (e) {
    await rm(temp, { recursive: true, force: true })
    throw e
  }
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Puts the staged name in place of the entry already there. The old entry is moved aside first, so a failure puts it back. */
async function replaceOne(staged: Staged, dir: string, name: string, owners: Record<string, string>): Promise<void> {
  // An earlier choice in the same batch may have changed what is there.
  const existing = await onDisk(dir, name)
  // Not under tempPrefix: an old folder that could not be put back must survive the next run's sweep.
  const aside = join(dir, `.portal-old-${randomUUID()}`)
  if (existing) {
    try {
      await rename(join(dir, existing), aside)
    } catch (e) {
      throw new Error(`${existing} is in use, so it was kept. Stop the server and download again. (${errorText(e)})`)
    }
  }
  try {
    await rename(join(staged.temp, name), join(dir, name))
  } catch (e) {
    if (existing && !(await rename(aside, join(dir, existing)).then(() => true, () => false)))
      throw new Error(`Could not put in ${name} or put the old one back (${errorText(e)}). The old folder is in ${aside}.`)
    throw e
  }
  if (existing) {
    delete owners[existing]
    await rm(aside, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
  }
  owners[name] = staged.owner
}

/**
 * Puts in the staged names `replace` picks and drops the rest. A name that fails is reported and the
 * others still go on. The temp folder is always removed.
 */
export async function applyStaged(
  staged: Staged,
  dir: string,
  replace: (c: StagedConflict) => boolean
): Promise<{ placed: string[]; skipped: string[]; failed: string[] }> {
  const placed: string[] = []
  const skipped: string[] = []
  const failed: string[] = []
  const owners = await readOwners(dir)
  try {
    for (const c of staged.conflicts) {
      if (!replace(c)) {
        skipped.push(c.name)
        continue
      }
      try {
        await replaceOne(staged, dir, c.name, owners)
        placed.push(c.name)
      } catch (e) {
        failed.push(errorText(e))
      }
    }
  } finally {
    if (placed.length) await writeOwners(dir, owners)
    await rm(staged.temp, { recursive: true, force: true })
  }
  return { placed, skipped, failed }
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
