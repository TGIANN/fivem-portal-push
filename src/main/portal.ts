import { app, BrowserWindow, session } from 'electron'
import type { PortalAsset, PortalAssetDetail } from '../shared/types'
import { log } from './log'

const API = 'https://portal-api.cfx.re/v1/'
const partition = 'persist:cfx'

export class AuthError extends Error {}

let ses: Electron.Session | null = null

function cfxSession(): Electron.Session {
  if (ses) return ses
  ses = session.fromPartition(partition)
  // This session only shows login pages; they need no camera, location and so on.
  ses.setPermissionRequestHandler((_, __, callback) => callback(false))
  ses.setUserAgent(
    ses
      .getUserAgent()
      .replace(/\s?Electron\/\S+/, '')
      .replace(`${app.getName()}/${app.getVersion()}`, '')
      .replace(/\s{2,}/g, ' ')
  )
  return ses
}

export function login(parent: BrowserWindow | null, interactive: boolean): Promise<boolean> {
  const win = new BrowserWindow({
    show: false,
    width: 520,
    height: 780,
    parent: parent ?? undefined,
    title: 'Cfx.re login',
    autoHideMenuBar: true,
    webPreferences: { session: cfxSession() }
  })

  return new Promise((resolve) => {
    let done = false
    let ssoRead = false

    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      log('auth', `in-app ${interactive ? 'interactive' : 'silent'} login ${ok ? 'finished' : 'failed'}`)
      if (!win.isDestroyed()) win.destroy()
      resolve(ok)
    }

    const timer = setTimeout(() => {
      if (interactive) win.show()
      else finish(false)
    }, 7000)

    const onNavigate = (_: unknown, url: string): void => {
      if (isLoggedInPortalUrl(url)) finish(true)
    }
    win.webContents.on('did-navigate', onNavigate)
    win.webContents.on('did-navigate-in-page', onNavigate)

    win.webContents.on('did-finish-load', async () => {
      const url = win.webContents.getURL()
      if (interactive && new URL(url).hostname === 'forum.cfx.re') {
        setTimeout(() => !done && !win.isDestroyed() && win.show(), 1500)
      }
      if (ssoRead || !url.startsWith(API)) return
      ssoRead = true
      try {
        const body = JSON.parse(await win.webContents.executeJavaScript('document.body.innerText'))
        win.loadURL(body.url)
      } catch {
        finish(false)
      }
    })

    win.on('closed', () => finish(false))
    win.loadURL(API + 'auth/discourse?return=')
  })
}

export async function logout(): Promise<void> {
  await cfxSession().clearStorageData()
}

function hiddenWindow(): BrowserWindow {
  return new BrowserWindow({ show: false, webPreferences: { session: cfxSession(), backgroundThrottling: false } })
}

function isLoggedInPortalUrl(url: string): boolean {
  const u = new URL(url)
  return u.hostname === 'portal.cfx.re' && u.pathname !== '/authenticate' && u.pathname !== '/login'
}

export async function getSsoUrl(): Promise<string> {
  const win = hiddenWindow()
  try {
    await win.loadURL(API + 'auth/discourse?return=')
    const body = JSON.parse(await win.webContents.executeJavaScript('document.body.innerText'))
    if (typeof body.url !== 'string') throw new Error('The portal did not return a login link')
    log('auth', 'sso link created in app session')
    return body.url
  } finally {
    win.destroy()
  }
}

export function completeSso(sso: string, sig: string): Promise<boolean> {
  const win = hiddenWindow()
  return new Promise((resolve) => {
    const finish = (ok: boolean, reason: string): void => {
      clearTimeout(timer)
      log('auth', `sso exchange ${ok ? 'finished' : 'failed'}: ${reason}`)
      if (!win.isDestroyed()) win.destroy()
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false, 'portal stayed on /authenticate for 20 s'), 20000)
    const onNavigate = (_: unknown, url: string): void => {
      if (isLoggedInPortalUrl(url)) finish(true, `redirected to ${new URL(url).pathname}`)
    }
    win.webContents.on('did-navigate', onNavigate)
    win.webContents.on('did-navigate-in-page', onNavigate)
    win.loadURL(`https://portal.cfx.re/authenticate?return=&sso=${encodeURIComponent(sso)}&sig=${encodeURIComponent(sig)}`)
  })
}

async function hasForumSession(): Promise<boolean> {
  const cookies = await cfxSession().cookies.get({ name: '_t' })
  return cookies.some((c) => (c.domain ?? '').includes('forum.cfx.re'))
}

async function hasPortalCookies(): Promise<boolean> {
  const cookies = await cfxSession().cookies.get({})
  return cookies.some((c) => (c.domain ?? '').replace(/^\./, '').endsWith('cfx.re'))
}

async function rawRequest(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  let payload: BodyInit | undefined
  if (body instanceof Multipart) {
    headers['Content-Type'] = body.contentType
    payload = body.data
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  const started = Date.now()
  const res = await cfxSession().fetch(API + path, { method, headers, body: payload, credentials: 'include' })
  log('api', `${method} ${path.split('?')[0]} -> ${res.status} (${Date.now() - started} ms)`)
  return res
}

function describe(res: Response, text: string): string {
  if (res.headers.get('cf-mitigated') || /<title>Just a moment|cf-browser-verification|challenge-platform/i.test(text)) {
    return 'Cloudflare blocked the request'
  }
  try {
    const json = JSON.parse(text)
    return json.message ?? json.error ?? (json.errors ? JSON.stringify(json.errors) : text.slice(0, 300))
  } catch {
    return text.replace(/\s+/g, ' ').slice(0, 300) || 'empty response'
  }
}

let reloginPromise: Promise<boolean> | null = null

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!(await hasPortalCookies())) throw new AuthError('Log in to the Cfx.re portal first.')
  let res = await rawRequest(method, path, body)

  if ((res.status === 401 || res.status === 403) && (await hasForumSession())) {
    reloginPromise ??= login(null, false).finally(() => (reloginPromise = null))
    if (await reloginPromise) res = await rawRequest(method, path, body)
  }

  const text = await res.text()
  if (res.ok) return (text ? JSON.parse(text) : {}) as T

  const detail = describe(res, text)
  log('api', `${method} ${path.split('?')[0]} failed ${res.status}: ${detail} | server=${res.headers.get('server')} cf-ray=${res.headers.get('cf-ray')} type=${res.headers.get('content-type')}`)
  if (res.status === 401 || res.status === 403) throw new AuthError(`The portal rejected the session (HTTP ${res.status}: ${detail}).`)
  throw new Error(`Portal ${method} ${path.split('?')[0]} failed (${res.status}): ${detail}`)
}

export async function checkAuth(): Promise<{ ok: boolean; reason: string | null }> {
  try {
    await request('GET', 'me/assets?search=&sort=asset.name&direction=asc')
    return { ok: true, reason: null }
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, reason: e.message }
    throw e
  }
}

export async function listAssets(search: string): Promise<PortalAsset[]> {
  const data = await request<{ items: PortalAsset[] }>('GET', `me/assets?search=${encodeURIComponent(search)}&sort=asset.name&direction=asc`)
  return data.items.map((a) => ({ id: a.id, name: a.name }))
}

export function assetDetail(id: number): Promise<PortalAssetDetail> {
  return request<PortalAssetDetail>('GET', `assets/${id}`)
}

export function deleteVersion(id: number, versionId: number): Promise<unknown> {
  return request('DELETE', `assets/${id}/versions/${versionId}`)
}

interface ReUploadResponse {
  asset_id: number
  version_id: number
  errors: unknown
}

export async function startUpload(
  id: number,
  file: { name: string; size: number; chunkSize: number },
  meta: { version: string; changelog: string; beta: boolean }
): Promise<{ assetId: number; versionId: number }> {
  const res = await request<ReUploadResponse>('POST', `assets/${id}/re-upload`, {
    chunk_count: Math.ceil(file.size / file.chunkSize),
    chunk_size: file.chunkSize,
    name: file.name,
    original_file_name: file.name,
    total_size: file.size,
    release_candidate: meta.beta,
    version: meta.version,
    changelog: meta.changelog
  })
  if (res.errors) throw new Error(`Portal rejected the upload: ${JSON.stringify(res.errors)}`)
  return { assetId: res.asset_id, versionId: res.version_id }
}

class Multipart {
  readonly boundary = `----PortalPush${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
  readonly data: Uint8Array<ArrayBuffer>

  constructor(fields: Record<string, string>, file: { field: string; filename: string; data: Buffer }) {
    const crlf = '\r\n'
    const parts: Buffer[] = []
    for (const [name, value] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${this.boundary}${crlf}Content-Disposition: form-data; name="${name}"${crlf}${crlf}${value}${crlf}`))
    }
    parts.push(
      Buffer.from(
        `--${this.boundary}${crlf}Content-Disposition: form-data; name="${file.field}"; filename="${file.filename}"${crlf}Content-Type: application/octet-stream${crlf}${crlf}`
      )
    )
    parts.push(file.data, Buffer.from(`${crlf}--${this.boundary}--${crlf}`))
    this.data = new Uint8Array(Buffer.concat(parts))
  }

  get contentType(): string {
    return `multipart/form-data; boundary=${this.boundary}`
  }
}

export function uploadChunk(id: number, versionId: number, index: number, chunk: Buffer): Promise<unknown> {
  const body = new Multipart({ chunk_id: String(index) }, { field: 'chunk', filename: 'blob', data: chunk })
  return request('POST', `assets/${id}/versions/${versionId}/upload-chunk`, body)
}

export function completeUpload(id: number, versionId: number): Promise<unknown> {
  return request('POST', `assets/${id}/versions/${versionId}/complete-upload`, {})
}
