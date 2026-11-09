import { app, shell } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { repoUrl } from '../shared/links'
import type { AppUpdateState } from '../shared/types'
import { log } from './log'

const firstCheckDelay = 5000
const recheckEvery = 4 * 60 * 60 * 1000
// The portable exe can not replace itself, so it only gets a link to the new one.
const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE)

let state: AppUpdateState = { status: app.isPackaged ? 'idle' : 'unsupported', current: app.getVersion(), version: null, notes: '', percent: 0, portable, error: null }
let notify: (s: AppUpdateState) => void = () => undefined
// A background check that fails stays quiet; only a check the user asked for shows its result.
let manual = false

function set(patch: Partial<AppUpdateState>): void {
  state = { ...state, ...patch }
  notify(state)
}

export const getAppUpdate = (): AppUpdateState => state

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }

/** GitHub sends the release notes as HTML. The app shows them as plain text, without the download section. */
function plainNotes(notes: UpdateInfo['releaseNotes']): string {
  const html = Array.isArray(notes) ? notes.map((n) => n.note ?? '').join('\n') : (notes ?? '')
  return html
    .replace(/<h2[^>]*>\s*Download\s*<\/h2>[\s\S]*?(?=<h2|$)/i, '')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => entities[e])
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000)
}

function errorText(e: Error): string {
  if (/latest\.yml/.test(e.message) && /404/.test(e.message)) return 'The newest release is still being built. Try again in a few minutes.'
  return e.message.split('\n')[0].slice(0, 200)
}

async function check(isManual: boolean): Promise<void> {
  if (state.status === 'unsupported' || state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return
  manual = isManual
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // Handled by the error event.
  } finally {
    manual = false
  }
}

export const checkAppUpdate = (): Promise<void> => check(true)

export function startAppUpdates(onChange: (s: AppUpdateState) => void): void {
  notify = onChange
  if (state.status === 'unsupported') return

  autoUpdater.logger = null
  autoUpdater.autoDownload = false

  autoUpdater.on('checking-for-update', () => {
    if (manual) set({ status: 'checking', error: null })
  })
  autoUpdater.on('update-available', (info) => {
    log('updater', `found ${info.version}`)
    set({ status: 'available', version: info.version, notes: plainNotes(info.releaseNotes), error: null })
  })
  autoUpdater.on('update-not-available', () => {
    if (manual) set({ status: 'latest' })
  })
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', () => {
    log('updater', 'download finished')
    set({ status: 'ready', percent: 100 })
  })
  autoUpdater.on('error', (e) => {
    const error = errorText(e)
    log('updater', error)
    if (state.status === 'downloading') set({ status: 'available', error })
    else if (manual) set({ status: 'error', error })
  })

  setTimeout(() => check(false), firstCheckDelay)
  setInterval(() => check(false), recheckEvery)
}

export async function downloadAppUpdate(): Promise<void> {
  if (state.status !== 'available') return
  if (portable) {
    await shell.openExternal(`${repoUrl}/releases/latest`)
    return
  }
  set({ status: 'downloading', percent: 0, error: null })
  await autoUpdater.downloadUpdate().catch(() => undefined)
}

export function installAppUpdate(): void {
  if (state.status === 'ready') autoUpdater.quitAndInstall(true, true)
}
