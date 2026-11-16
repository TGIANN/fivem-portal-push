import { existsSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import type { DownloadEntity, DownloadProgress, Downloadable, PortalVersion } from '../shared/types'
import { pickVersion } from '../shared/version'
import { extractInto, pickPack, safeName } from './archive'
import { assetDetail, fetchToFile, grantDetail, listCreatedAssets, listGrantedAssets, packDownloadUrl } from './portal'

interface Listed {
  item: Downloadable
  versions: PortalVersion[] | undefined
}

// What the last list showed. A download request names items by key, so it can only fetch what was listed.
const listed = new Map<string, Listed>()

function unavailable(disabled: boolean, versions: PortalVersion[] | undefined): string | null {
  if (disabled) return 'Disabled on the portal'
  if (versions && !versions.some((v) => v.state === 'active')) return 'No active version'
  return null
}

export async function listDownloadables(entity: DownloadEntity): Promise<Downloadable[]> {
  const rows: Listed[] =
    entity === 'assets'
      ? (await listCreatedAssets()).map((a) => ({
          versions: a.versions,
          item: {
            key: `assets:${a.id}`,
            entity: 'assets',
            entityId: a.id,
            name: a.name,
            author: null,
            version: pickVersion(a.versions)?.version ?? null,
            updatedAt: a.updated_at ?? null,
            receivedAt: null,
            updated: false,
            unavailable: unavailable(Boolean(a.is_disabled), a.versions)
          }
        }))
      : (await listGrantedAssets()).map((g) => ({
          versions: g.asset.versions,
          item: {
            key: `asset-grants:${g.grant_id}`,
            entity: 'asset-grants',
            entityId: g.grant_id,
            name: g.asset.name,
            author: g.asset.author ?? null,
            version: null,
            updatedAt: g.updated_at ?? null,
            receivedAt: g.received_at ?? null,
            updated: Boolean(g.updated_since_last_download),
            unavailable: unavailable(Boolean(g.asset.is_disabled), g.asset.versions)
          }
        }))
  for (const key of [...listed.keys()]) if (key.startsWith(`${entity}:`)) listed.delete(key)
  for (const row of rows) listed.set(row.item.key, row)
  return rows.map((r) => r.item)
}

// A grant's full versions, until the asset changes on the portal.
const grantCache = new Map<string, PortalVersion[]>()
const cacheKey = (item: Downloadable): string => `${item.key}@${item.updatedAt}`

async function readGrant(item: Downloadable): Promise<PortalVersion[]> {
  const cached = grantCache.get(cacheKey(item))
  if (cached) return cached
  const versions = (await grantDetail(item.entityId)).asset.versions ?? []
  grantCache.set(cacheKey(item), versions)
  return versions
}

/** The versions with their numbers: the grants list leaves them out, so one grant is read on its own. */
async function fullVersions({ item, versions }: Listed): Promise<PortalVersion[]> {
  if (item.entity === 'asset-grants') return readGrant(item)
  return versions ?? (await assetDetail(item.entityId)).versions
}

/** The version numbers of up to 25 listed grants, read three at a time so the list fills without hammering the portal. */
export async function grantVersions(keys: string[]): Promise<Record<string, string | null>> {
  const rows = keys
    .slice(0, 25)
    .map((k) => listed.get(k)?.item)
    .filter((i): i is Downloadable => i?.entity === 'asset-grants' && !i.unavailable)
  const out: Record<string, string | null> = {}
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < rows.length) {
      const item = rows[next++]
      out[item.key] = pickVersion(await readGrant(item))?.version ?? null
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return out
}

async function downloadOne(row: Listed, dir: string, claim: (name: string) => string, extract: boolean, emit: (p: DownloadProgress) => void, cancelled: () => boolean): Promise<string> {
  const { item } = row
  if (item.unavailable) throw new Error(item.unavailable)
  const version = pickVersion(await fullVersions(row))
  if (!version) throw new Error('No active version')
  const pack = pickPack(version.packs)
  if (!pack) throw new Error('This version has no download')
  const url = await packDownloadUrl(item.entity, item.entityId, version.id, pack.id)
  const label = version.version ?? ''

  const zipPath = join(dir, `${claim(label ? `${safeName(item.name)}-${safeName(label)}` : safeName(item.name))}.zip`)
  await fetchToFile(url, zipPath, (received, total) => emit({ key: item.key, status: 'running', progress: total ? received / total : undefined, version: label }), cancelled)
  if (!extract) return `Saved ${zipPath.split(/[\\/]/).pop()}`
  emit({ key: item.key, status: 'running', message: 'Unpacking', version: label })
  try {
    const names = await extractInto(zipPath, dir, item.key)
    return `Unpacked to ${names.join(', ')}`
  } finally {
    await rm(zipPath, { force: true })
  }
}

/** Downloads one after another, so a long list does not hammer the portal. */
export async function runDownloads(keys: string[], dir: string, extract: boolean, emit: (p: DownloadProgress) => void, cancelled: () => boolean): Promise<{ done: number; failed: number }> {
  if (!existsSync(dir)) throw new Error(`${dir} does not exist. Pick the download folder again.`)
  let done = 0
  let failed = 0
  // Two assets with the same name in one batch must not write over each other.
  const used = new Set<string>()
  const claim = (base: string): string => {
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})`
    used.add(name.toLowerCase())
    return name
  }
  for (const key of keys) {
    const row = listed.get(key)
    if (!row) continue
    if (cancelled()) break
    emit({ key, status: 'running', progress: 0 })
    let version: string | undefined
    try {
      const onProgress = (p: DownloadProgress): void => {
        if (p.version) version = p.version
        emit(p)
      }
      const message = await downloadOne(row, dir, claim, extract, onProgress, cancelled)
      emit({ key, status: 'done', message, version })
      done++
    } catch (e) {
      emit({ key, status: 'error', message: e instanceof Error ? e.message : String(e), version })
      failed++
    }
  }
  return { done, failed }
}
