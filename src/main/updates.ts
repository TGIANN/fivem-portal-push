import { app } from 'electron'
import { readFile } from 'fs/promises'
import { basename, extname } from 'path'
import type { DiscordRole, TebexPackage, UpdatePost, UpdateTarget } from '../shared/types'
import { updateApiDocsUrl } from '../shared/links'
import { getSecret } from './secrets'
import { getConfig } from './store'

const discordApi = 'https://discord.com/api/v10'
const brandColor = 0x36ff9f
const maxImages = 10

export const webhookPattern = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+\/?$/

const imageTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }
export const imageExtensions = Object.keys(imageTypes).map((e) => e.slice(1))

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return text
  }
}

// A target that never answers must not hang the push.
const timeout = (ms = 30_000) => AbortSignal.timeout(ms)
const uploadTimeout = 120_000

const clamp = (text: string, max = 300) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

function errorText(body: unknown, fallback: string): string {
  return clamp(rawErrorText(body, fallback))
}

function rawErrorText(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as { error?: unknown; message?: unknown }
    if (typeof b.error === 'string') return b.error
    if (typeof b.message === 'string') return b.message
  }
  return typeof body === 'string' && body && body.length < 200 ? body : fallback
}

// ---------- Tebex ----------

const tebexCache = new Map<string, TebexPackage[]>()

export async function tebexPackages(refresh = false): Promise<TebexPackage[]> {
  const token = getConfig().update.tebexToken.trim()
  if (!token) throw new Error('Add your Tebex public key in Settings to pick a package.')
  const cached = tebexCache.get(token)
  if (cached && !refresh) return cached

  const res = await fetch(`https://headless.tebex.io/api/accounts/${encodeURIComponent(token)}/packages`, { signal: timeout() })
  const body = await readJson(res)
  if (!res.ok) throw new Error(`Tebex: ${errorText(body, `HTTP ${res.status}`)}. Check the public key in Settings.`)
  const list = ((body as { data?: { id: number; name: string }[] })?.data ?? [])
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
  tebexCache.set(token, list)
  return list
}

// ---------- Discord ----------

async function discordBot<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getSecret('botToken')
  if (!token) throw new Error('Add a Discord bot token in Settings.')
  const res = await fetch(discordApi + path, { signal: timeout(init.body ? uploadTimeout : undefined), ...init, headers: { ...init.headers, Authorization: `Bot ${token}` } })
  const body = await readJson(res)
  if (!res.ok) throw new Error(`Discord: ${errorText(body, `HTTP ${res.status}`)}`)
  return body as T
}

function botChannel(): string {
  const channel = getConfig().update.discordChannel.trim()
  if (!/^\d{5,25}$/.test(channel)) throw new Error('Add the Discord channel ID in Settings.')
  return channel
}

let rolesCache: { key: string; roles: DiscordRole[] } | null = null

export async function discordRoles(refresh = false): Promise<DiscordRole[]> {
  if (getConfig().update.discordMode !== 'bot') throw new Error('Role list needs the bot mode in Settings.')
  const channel = botChannel()
  if (rolesCache?.key === channel && !refresh) return rolesCache.roles

  const { guild_id } = await discordBot<{ guild_id?: string }>(`/channels/${channel}`)
  if (!guild_id) throw new Error('This channel is not in a server.')
  const raw = await discordBot<{ id: string; name: string; color: number; position: number; managed: boolean }[]>(`/guilds/${guild_id}/roles`)
  const roles = raw
    .filter((r) => r.id !== guild_id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color }))
  rolesCache = { key: channel, roles }
  return roles
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Discord embeds do not render markdown lists, so bullets become "•". */
function formatNotes(notes: string): string {
  return notes
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\s*\\?([*-])\s+/, '• '))
    .join('\n')
    .replace(/(• [^\n]*)\n{2,}(?=• )/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** The changelog is a fenced block in the app; targets get the plain lines. */
export function plainChangedFiles(text: string): string {
  return text
    .trim()
    .replace(/^```[\w-]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim()
}

interface Link {
  url: string
  label: string | null
}

/**
 * The ping at the top of the post. @here and @everyone only go out when they are
 * turned on in Settings; a role needs a numeric ID. Embeds never ping, so the
 * notes can not mention anyone.
 */
function checkedTag(tag: string | null): string | null {
  const { allowHere, allowEveryone } = getConfig().update
  if (tag === 'here' || tag === 'everyone') {
    if (!(tag === 'here' ? allowHere : allowEveryone)) throw new Error(`@${tag} is turned off in Settings, Update post.`)
    return tag
  }
  return tag && /^\d{5,25}$/.test(tag) ? tag : null
}

function mention(tag: string | null): { content: string; allowed_mentions: { parse: string[]; roles: string[] } } {
  const t = checkedTag(tag)
  if (t === 'here' || t === 'everyone') return { content: `@${t}`, allowed_mentions: { parse: ['everyone'], roles: [] } }
  if (t) return { content: `<@&${t}>`, allowed_mentions: { parse: [], roles: [t] } }
  return { content: '', allowed_mentions: { parse: [], roles: [] } }
}

function discordPayload(post: UpdatePost, title: string, version: string, link: Link | null) {
  const v = version.replace(/^v/i, '')
  const linkLine = link?.label ? `\n\n🌐 [${link.label}](${link.url})` : ''
  const embeds: Record<string, unknown>[] = [
    {
      author: { name: title },
      title: `v${v}`,
      ...(link && { url: link.url }),
      description: truncate(formatNotes(post.notes) || `Version ${v}`, 3900) + linkLine,
      color: brandColor
    }
  ]
  const files = plainChangedFiles(post.changedFiles)
  if (files) embeds.push({ title: 'Changed files', description: '```diff\n' + truncate(files, 3950) + '\n```', color: 0x2b2d31 })
  embeds[embeds.length - 1].timestamp = new Date().toISOString()

  return {
    ...mention(post.roleId),
    embeds
  }
}

async function imageBlob(path: string): Promise<{ blob: Blob; name: string }> {
  const type = imageTypes[extname(path).toLowerCase()]
  if (!type) throw new Error(`${basename(path)} is not a supported image`)
  return { blob: new Blob([new Uint8Array(await readFile(path))], { type }), name: basename(path) }
}

async function postToDiscord(post: UpdatePost, title: string, version: string, link: Link | null): Promise<string> {
  const form = new FormData()
  const images = post.images.slice(0, maxImages)
  const payload = { ...discordPayload(post, title, version, link), attachments: images.map((_, i) => ({ id: i })) }
  form.append('payload_json', JSON.stringify(payload))
  for (const [i, path] of images.entries()) {
    const { blob, name } = await imageBlob(path)
    form.append(`files[${i}]`, blob, `update-${i}${extname(name).toLowerCase()}`)
  }

  const { discordMode } = getConfig().update
  if (discordMode === 'bot') {
    const msg = await discordBot<{ id: string }>(`/channels/${botChannel()}/messages`, { method: 'POST', body: form })
    return msg.id
  }

  const webhook = getSecret('webhookUrl')
  if (!webhook) throw new Error('Add a Discord webhook URL in Settings.')
  const res = await fetch(`${webhook.replace(/\/$/, '')}?wait=true`, { method: 'POST', body: form, signal: timeout(uploadTimeout) })
  const body = await readJson(res)
  if (!res.ok) throw new Error(`Discord: ${errorText(body, `HTTP ${res.status}`)}`)
  return (body as { id: string }).id
}

// ---------- Update API ----------
// Contract in docs/update-api.md: GET <url> checks the key, POST <url> creates
// an update and answers { id, url?, linkLabel? }, POST <url>/<id>/images adds one image.

const bareHost = (url: URL) => url.host.replace(/^www\./, '')

/**
 * fetch drops the Authorization header when a redirect changes the host, so a
 * site that sends example.com to www.example.com would see no key. Follow those
 * redirects here and keep the key only on the same site.
 */
async function fetchWithKey(url: string, init: RequestInit, key: string): Promise<Response> {
  let current = new URL(url)
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(current, { signal: timeout(init.body ? uploadTimeout : undefined), ...init, redirect: 'manual', headers: { ...init.headers, Authorization: `Bearer ${key}` } })
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!location) return res
    const next = new URL(location, current)
    if (next.protocol !== 'https:' && current.protocol === 'https:') throw new Error(`API: the URL redirects to ${next.href}, which is not https.`)
    if (bareHost(next) !== bareHost(current)) throw new Error(`API: the URL redirects to another site (${next.origin}). Put the final URL in Settings.`)
    current = next
  }
  throw new Error('API: too many redirects. Check the URL in Settings.')
}

interface ApiTarget {
  base: string
  host: string
  key: string
}

function apiTarget(): ApiTarget {
  const base = getConfig().update.apiUrl.trim().replace(/\/+$/, '')
  const key = getSecret('apiKey')
  if (!base || !key) throw new Error('Add the update API URL and key in Settings.')
  let host: string
  try {
    const url = new URL(base)
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error()
    host = url.host
  } catch {
    throw new Error(`The update API URL "${base}" is not a valid https URL. Check it in Settings.`)
  }
  return { base, host, key }
}

/** The server's own message, when it sent one as { "error": "..." } or short plain text. */
function serverMessage(body: unknown): string | null {
  const text = errorText(body, '')
  return text && !text.trimStart().startsWith('<') ? text : null
}

async function api<T>(target: ApiTarget, path: string, init: RequestInit = {}): Promise<T> {
  const url = target.base + path
  const headers = { ...init.headers, Accept: 'application/json', 'User-Agent': `FiveM-Portal-Push/${app.getVersion()}` }
  let res: Response
  try {
    res = await fetchWithKey(url, { ...init, headers }, target.key)
  } catch (e) {
    const cause = e instanceof Error ? ((e.cause as Error | undefined)?.message ?? e.message) : String(e)
    throw new Error(cause.startsWith('API:') ? cause : `Could not reach ${target.host}: ${cause}`)
  }
  const body = await readJson(res)
  if (res.ok) return body as T

  const message = serverMessage(body)
  const http = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`
  if (res.status === 401 || res.status === 403) throw new Error(`${target.host} did not accept the API key (${http})${message ? `: ${message}` : ''}. Check the key in Settings.`)
  if (res.status === 404 || res.status === 405) throw new Error(`${target.host} has no Update API at ${url} (${http}). Check the URL in Settings.`)
  throw new Error(`${target.host} answered ${http}${message ? `: ${message}` : ''}`)
}

const docsHint = `The format is in the Update API docs: ${updateApiDocsUrl}`

interface ApiCreated {
  id: string | number
  url: string | null
  linkLabel: string | null
}

function readCreated(body: unknown, host: string): ApiCreated {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  // The id goes into the image URL path, so keep it to plain id characters.
  if ((typeof b.id !== 'string' && typeof b.id !== 'number') || !/^[\w-]{1,64}$/.test(String(b.id))) {
    throw new Error(`${host} answered without a usable update id. The answer must be JSON with the new update's "id": a number, or letters, digits, - and _ (up to 64). ${docsHint}`)
  }
  const url = typeof b.url === 'string' && /^https?:\/\//.test(b.url) ? b.url : null
  // The label becomes a markdown link text in Discord: no brackets or line breaks.
  const label = typeof b.linkLabel === 'string' ? clamp(b.linkLabel.replace(/[[\]()\r\n]/g, ' ').replace(/\s+/g, ' ').trim(), 100) : ''
  return { id: b.id, url, linkLabel: url && label ? label : null }
}

async function postToApi(target: ApiTarget, post: UpdatePost, script: string, version: string, beta: boolean, progress: (m: string) => void): Promise<ApiCreated> {
  const body = await api<unknown>(target, '', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      script,
      version,
      beta,
      package: post.package,
      notes: post.notes.trim(),
      changedFiles: plainChangedFiles(post.changedFiles),
      imageCount: Math.min(post.images.length, maxImages)
    })
  })
  const created = readCreated(body, target.host)

  const images = post.images.slice(0, maxImages)
  for (const [i, path] of images.entries()) {
    progress(`${target.host}: image ${i + 1}/${images.length}`)
    const { blob, name } = await imageBlob(path)
    const form = new FormData()
    form.append('image', blob, name)
    try {
      await api(target, `/${encodeURIComponent(String(created.id))}/images`, { method: 'POST', body: form })
    } catch (e) {
      throw new Error(`The update was saved, but image ${name} failed. ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return created
}

const apiRolesCache = new Map<string, DiscordRole[]>()

/** Roles the update API can tag in its own Discord announcement (GET <url>/roles). */
export async function apiRoles(refresh = false): Promise<DiscordRole[]> {
  const target = apiTarget()
  const cached = apiRolesCache.get(target.base)
  if (cached && !refresh) return cached
  const body = await api<{ roles?: unknown }>(target, '/roles')
  const list = Array.isArray(body?.roles) ? body.roles : null
  if (!list) throw new Error(`${target.host} answered /roles without a "roles" list. ${docsHint}`)
  const roles = list
    .filter((r): r is { id: unknown; name: unknown; color?: unknown } => Boolean(r) && typeof r === 'object')
    .filter((r) => typeof r.id === 'string' && /^\d{5,25}$/.test(r.id) && typeof r.name === 'string')
    .map((r) => ({ id: r.id as string, name: clamp(r.name as string, 100), color: typeof r.color === 'number' ? r.color : 0 }))
  apiRolesCache.set(target.base, roles)
  return roles
}

export async function postUpdate(post: UpdatePost, script: string, version: string, beta: boolean, progress: (m: string) => void): Promise<string> {
  const done: string[] = []
  let link: Link | null = null
  // Refuse a disallowed @here / @everyone before anything is saved anywhere.
  const tag = post.apiAnnounce || post.discord ? checkedTag(post.roleId) : null

  if (post.api) {
    const target = apiTarget()
    progress(`Posting to ${target.host}`)
    const created = await postToApi(target, post, script, version, beta, progress)
    if (created.url) link = { url: created.url, label: created.linkLabel }
    if (post.apiAnnounce) {
      progress(`${target.host}: posting to Discord`)
      try {
        await api(target, `/${encodeURIComponent(String(created.id))}/announce`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roleId: tag })
        })
      } catch (e) {
        throw new Error(`The update was saved on ${target.host}, but it could not post it to Discord. ${e instanceof Error ? e.message : String(e)}`)
      }
      done.push(`${target.host} (with its Discord post)`)
    } else {
      done.push(target.host)
    }
  }

  if (post.discord) {
    progress('Posting to Discord')
    try {
      await postToDiscord(post, post.package?.name ?? script, version, link)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      throw new Error(done.length ? `Saved to ${done[0]}, but Discord failed. ${message}` : message)
    }
    done.push('Discord')
  }

  return `Posted to ${done.join(' and ')}`
}

export async function checkTarget(target: UpdateTarget): Promise<string> {
  if (target === 'tebex') {
    const list = await tebexPackages(true)
    return `${list.length} packages found`
  }
  if (target === 'api') {
    const endpoint = apiTarget()
    const body = await api<{ name?: unknown } | null>(endpoint, '')
    const name = body && typeof body === 'object' && typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null
    const connected = name ? `Connected to ${name} (${endpoint.host})` : `Connected to ${endpoint.host}`
    if (!getConfig().update.apiAnnounces) return connected
    const roles = await apiRoles(true)
    return `${connected}, ${roles.length} Discord roles`
  }
  if (getConfig().update.discordMode === 'bot') {
    const ch = await discordBot<{ name?: string }>(`/channels/${botChannel()}`)
    const roles = await discordRoles(true)
    return `Connected to #${ch.name ?? 'channel'}, ${roles.length} roles`
  }
  const webhook = getSecret('webhookUrl')
  if (!webhook) throw new Error('Add a Discord webhook URL in Settings.')
  const res = await fetch(webhook, { signal: timeout() })
  const body = await readJson(res)
  if (!res.ok) throw new Error(`Discord: ${errorText(body, `HTTP ${res.status}`)}`)
  return `Connected to webhook ${(body as { name?: string }).name ?? ''}`.trim()
}
