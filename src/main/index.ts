import './paths'
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { existsSync, statSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import { cleanBuildDirs } from '../shared/buildDirs'
import type { BundleSpec, PushRequest, SecretName, TebexPackage, UpdateImage, UpdatePost, UpdateSettings, UpdateTarget } from '../shared/types'
import { checkAppUpdate, downloadAppUpdate, getAppUpdate, installAppUpdate, startAppUpdates } from './appUpdate'
import { browserLogin, cancelBrowserLogin, extensionDir } from './browserLogin'
import { isInside, readBundle, toSource, writeBundle } from './bundle'
import { runChecks } from './checks'
import { changedFiles, gitRoot } from './git'
import { scriptHistory } from './history'
import { compileRules, ignoreRules, isExcluded, writeLocalPatterns, zipTree } from './ignore'
import { assetDetail, AuthError, checkAuth, listAssets, login, logout } from './portal'
import { push } from './push'
import { takeScreenshots } from './screenshots'
import { scanScripts } from './scripts'
import { setSecret } from './secrets'
import { getConfig, updateConfig } from './store'
import { apiRoles, checkTarget, discordRoles, imageExtensions, postUpdate, tebexPackages, webhookPattern } from './updates'
import { isBetaVersion, versionFormat } from '../shared/version'
import { log, logFile } from './log'

let win: BrowserWindow | null = null
let pushing = false
let cancelPush = false

function scriptArg(argv: string[]): string | null {
  for (const arg of argv.slice(app.isPackaged ? 1 : 2)) {
    if (arg.startsWith('-')) continue
    const dir = resolve(arg)
    if (existsSync(join(dir, 'fxmanifest.lua'))) return dir
  }
  return null
}

function openScript(dir: string | null): void {
  if (!dir || !win) return
  const cfg = getConfig()
  if (!cfg.roots.some((r) => isInside(r, dir))) {
    updateConfig((c) => c.roots.push(dirname(dir)))
  }
  win.webContents.send('script:open', dir)
}

/** Paths from the renderer must be a script in one of the sidebar folders. */
function checkScript(path: string): string {
  const dir = resolve(path)
  if (!getConfig().roots.some((r) => isInside(resolve(r), dir)) || !existsSync(join(dir, 'fxmanifest.lua'))) throw new Error(`${dir} is not a script in your folders`)
  return dir
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (event.sender !== win?.webContents) throw new Error('This window can not use the app')
      return { ok: true, data: await fn(...(args as A)) }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      log('ipc', `${channel} failed: ${error}`)
      return { ok: false, error, auth: e instanceof AuthError }
    }
  })
}

handle('config:get', () => getConfig())

handle('roots:add', async () => {
  const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'multiSelections'], title: 'Add script folder' })
  return updateConfig((cfg) => {
    for (const p of res.filePaths) if (!cfg.roots.includes(p)) cfg.roots.push(p)
  })
})

handle('roots:remove', (root: string) => updateConfig((cfg) => (cfg.roots = cfg.roots.filter((r) => r !== root))))

handle('scripts:scan', () => scanScripts(getConfig().roots))

handle('auth:check', () => checkAuth())
handle('auth:login', () => login(win, true))
handle('auth:logout', () => logout())
handle('auth:browserLogin', () =>
  browserLogin(() => {
    log('auth', 'browser session received')
    if (win?.isMinimized()) win.restore()
    win?.show()
    win?.focus()
  })
)
handle('auth:cancelBrowserLogin', () => cancelBrowserLogin())
handle('extension:open', () => shell.openPath(extensionDir()))

handle('portal:assets', (search: string) => listAssets(search))
handle('portal:detail', (id: number) => assetDetail(id))

handle('git:changes', async (path: string) => {
  const scriptPath = checkScript(path)
  const repo = await gitRoot(scriptPath)
  if (!repo) return null
  const since = getConfig().lastPush[scriptPath.split(/[\\/]/).pop()!]?.commit ?? null
  const files = await changedFiles(repo, scriptPath, since).catch(() => changedFiles(repo, scriptPath, null))
  const match = compileRules(ignoreRules(scriptPath))
  return { since, files: files.filter((f) => !isExcluded(match, f.file)) }
})

handle('zip:tree', (scriptPath: string) => zipTree(checkScript(scriptPath)))
handle('ignore:setLocal', (scriptPath: string, patterns: string[]) => writeLocalPatterns(checkScript(scriptPath), patterns))
handle('ignore:setGlobal', (patterns: string[]) => updateConfig((cfg) => (cfg.zipIgnore = [...new Set(patterns.map((p) => p.trim()).filter(Boolean))])))

handle('bundle:set', (scriptPath: string, specs: BundleSpec[]) => writeBundle(checkScript(scriptPath), specs))
handle('bundle:add', async (path: string, kind: 'folder' | 'file') => {
  const scriptPath = checkScript(path)
  const res = await dialog.showOpenDialog(win!, {
    title: kind === 'folder' ? 'Add folders to the zip' : 'Add files to the zip',
    defaultPath: dirname(scriptPath),
    properties: [kind === 'folder' ? 'openDirectory' : 'openFile', 'multiSelections']
  })
  if (res.canceled || res.filePaths.length === 0) return
  const specs = readBundle(scriptPath)
  for (const p of res.filePaths) {
    const source = toSource(scriptPath, p)
    if (!specs.some((s) => s.source === source)) specs.push({ source, target: null })
  }
  await writeBundle(scriptPath, specs)
})

handle('settings:update', (patch: Partial<UpdateSettings>) =>
  updateConfig((cfg) => {
    cfg.update = { ...cfg.update, ...patch }
  })
)
handle('settings:buildDirs', (dirs: string[]) => updateConfig((cfg) => (cfg.buildDirs = cleanBuildDirs(dirs))))
// Saved when it is picked, so the choice is there next time even without a push.
handle('script:remember', (scriptPath: string, patch: { package?: TebexPackage; roleId?: string | null }) => {
  const name = basename(checkScript(scriptPath))
  return updateConfig((cfg) => {
    if (patch.package) cfg.packages[name] = patch.package
    if (patch.roleId !== undefined) cfg.roles[name] = patch.roleId && /^(\d{5,25}|here|everyone)$/.test(patch.roleId) ? patch.roleId : null
  })
})
handle('settings:secret', (name: SecretName, value: string | null) => {
  if (name === 'webhookUrl' && value?.trim() && !webhookPattern.test(value.trim())) {
    throw new Error('This is not a Discord webhook URL. Copy it from Channel settings, Integrations, Webhooks.')
  }
  setSecret(name, value)
  return getConfig()
})
handle('update:check', (target: UpdateTarget) => checkTarget(target))
handle('update:post', (scriptPath: string, version: string, post: UpdatePost) => {
  checkImages(post)
  log('update', `retry ${scriptPath} ${version} api=${post.api} discord=${post.discord}`)
  return postUpdate(post, basename(scriptPath), version, isBetaVersion(version), () => undefined)
})
handle('tebex:packages', (refresh: boolean) => tebexPackages(refresh))
handle('discord:roles', (refresh: boolean) => discordRoles(refresh))
handle('update:apiRoles', (refresh: boolean) => apiRoles(refresh))
// Only files the user picked in this dialog can be uploaded with an update.
const pickedImages = new Set<string>()
const checkImages = (post: UpdatePost | null): void => {
  const unknown = post?.images.find((p) => !pickedImages.has(p))
  if (unknown) throw new Error(`${basename(unknown)} was not picked with Add images`)
}

handle('images:pick', async (): Promise<UpdateImage[]> => {
  const res = await dialog.showOpenDialog(win!, { title: 'Add images to the update', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: imageExtensions }] })
  for (const path of res.filePaths) pickedImages.add(path)
  return res.filePaths.map((path) => ({
    path,
    name: basename(path),
    size: statSync(path).size,
    thumb: nativeImage.createFromPath(path).resize({ height: 120 }).toDataURL()
  }))
})

handle('settings:gitDefault', (value: boolean) =>
  updateConfig((cfg) => {
    cfg.gitDefault = value
    cfg.git = {}
  })
)

handle('push:start', async (req: PushRequest) => {
  if (pushing) throw new Error('A push is already running')
  checkImages(req.update)
  if (!versionFormat.test(req.version)) throw new Error(`${req.version} is not a valid version`)
  const scriptPath = checkScript(req.scriptPath)
  pushing = true
  cancelPush = false
  try {
    log('push', `start ${scriptPath} -> asset ${req.assetId} version ${req.version} git=${req.git} replace=${req.replace}`)
    await push({ ...req, scriptPath }, (p) => {
      if (p.status !== 'running' || p.progress === undefined) log('push', `${p.step} ${p.status}${p.message ? ': ' + p.message : ''}`)
      win?.webContents.send('push:progress', p)
    }, () => cancelPush)
  } finally {
    pushing = false
  }
})

handle('push:cancel', () => {
  cancelPush = true
})
handle('checks:run', (scriptPath: string) => runChecks(checkScript(scriptPath)))
handle('checks:allow', (scriptPath: string, id: string, allowed: boolean) => {
  const name = basename(checkScript(scriptPath))
  if (!/^[a-f0-9]{16}$/.test(id)) throw new Error('Not a finding of the check')
  return updateConfig((cfg) => {
    const rest = (cfg.secretAllow[name] ?? []).filter((x) => x !== id)
    cfg.secretAllow[name] = allowed ? [...rest, id] : rest
  })
})
handle('history:get', (scriptPath: string) => scriptHistory(basename(checkScript(scriptPath))))

handle('shell:open', (path: string) => shell.openPath(checkScript(path)))
handle('log:open', () => shell.openPath(logFile))

handle('appUpdate:get', () => getAppUpdate())
handle('appUpdate:check', () => checkAppUpdate())
handle('appUpdate:download', () => downloadAppUpdate())
handle('appUpdate:install', () => {
  if (pushing) throw new Error('Wait for the push to finish before restarting.')
  installAppUpdate()
})

const screenshots = process.argv.includes('--screenshots')
const demo = screenshots || process.argv.includes('--demo')

if (screenshots) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
}

if (!demo && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_, argv) => {
    if (win?.isMinimized()) win.restore()
    win?.focus()
    openScript(scriptArg(argv))
  })

  app.whenReady().then(() => {
    win = new BrowserWindow({
      width: screenshots ? 1280 : 1240,
      height: screenshots ? 820 : 800,
      minWidth: 980,
      minHeight: 640,
      backgroundColor: '#000000',
      title: 'FiveM Portal Push',
      icon: app.isPackaged ? undefined : join(app.getAppPath(), 'build/icon.png'),
      autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, additionalArguments: demo ? ['--portal-push-demo'] : [] }
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) shell.openExternal(url)
      return { action: 'deny' }
    })
    // The window only ever shows the app. Without this, a file dropped on it opens with the app's API.
    win.webContents.on('will-navigate', (e) => e.preventDefault())

    if (screenshots) {
      const target = win
      target.setAlwaysOnTop(true)
      target.webContents.once('did-finish-load', () =>
        takeScreenshots(target)
          .catch((e) => console.error(e))
          .finally(() => app.quit())
      )
    } else if (!demo) {
      win.webContents.once('did-finish-load', () => {
        openScript(scriptArg(process.argv))
        startAppUpdates((state) => win?.webContents.send('appUpdate:state', state))
      })
    }

    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
    else win.loadFile(join(__dirname, '../renderer/index.html'))
  })

  app.on('window-all-closed', () => app.quit())
}
