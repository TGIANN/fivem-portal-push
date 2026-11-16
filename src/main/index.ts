import './paths'
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, statSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import { cleanBuildDirs } from '../shared/buildDirs'
import type { BundleSpec, DownloadEntity, DownloadProgress, EncryptJob, PushRequest, SecretName, TebexPackage, UpdateImage, UpdatePost, UpdateSettings, UpdateTarget } from '../shared/types'
import { checkAppUpdate, downloadAppUpdate, getAppUpdate, installAppUpdate, startAppUpdates } from './appUpdate'
import { pickPack, safeName } from './archive'
import { browserLogin, cancelBrowserLogin, extensionDir } from './browserLogin'
import { isInside, readBundle, toSource, writeBundle } from './bundle'
import { runChecks } from './checks'
import { listDownloadables, runDownloads } from './downloads'
import { folderProblem, runEncrypt } from './encrypt'
import { changedFiles, gitRoot } from './git'
import { scriptHistory } from './history'
import { compileRules, ignoreRules, isExcluded, writeLocalPatterns, zipTree } from './ignore'
import { assetDetail, AuthError, checkAuth, fetchToFile, listAssets, login, logout, packDownloadUrl } from './portal'
import { push } from './push'
import { takeScreenshots } from './screenshots'
import { scanScripts } from './scripts'
import { setSecret } from './secrets'
import { getConfig, updateConfig } from './store'
import { apiRoles, checkTarget, discordRoles, imageExtensions, postUpdate, tebexPackages, webhookPattern } from './updates'
import { isBetaVersion, ownVersion, versionFormat } from '../shared/version'
import { log, logFile } from './log'

let win: BrowserWindow | null = null
// A push and a folder encryption both upload; only one runs at a time.
let pushing = false
let cancelPush = false
let downloading = false
let cancelDownloads = false

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

// ---------- Downloads ----------

const sendDownload = (p: DownloadProgress): void => win?.webContents.send('download:progress', p)
// Only files saved by the app can be shown in Explorer from the window.
const savedFiles = new Set<string>()

handle('portal:downloadVersion', async (assetId: number, versionId: number) => {
  if (!Number.isInteger(assetId) || !Number.isInteger(versionId)) throw new Error('Bad version')
  const detail = await assetDetail(assetId)
  const version = detail.versions?.find((v) => v.id === versionId)
  if (!version) throw new Error('This version is no longer on the portal.')
  if (version.state !== 'active') throw new Error(`${version.version} is not ready on the portal yet (${version.state}).`)
  const pack = pickPack(version.packs)
  if (!pack) throw new Error(`The portal shows no download for ${version.version}.`)
  const res = await dialog.showSaveDialog(win!, {
    title: `Save ${detail.name} ${version.version}`,
    defaultPath: join(app.getPath('downloads'), `${safeName(detail.name)}-${safeName(version.version)}.zip`),
    filters: [{ name: 'Zip', extensions: ['zip'] }]
  })
  if (res.canceled || !res.filePath) return null
  const key = `version:${versionId}`
  log('download', `${detail.name} ${version.version} -> ${res.filePath}`)
  try {
    const url = await packDownloadUrl('assets', assetId, versionId, pack.id)
    await fetchToFile(url, res.filePath, (received, total) => sendDownload({ key, status: 'running', progress: total ? received / total : undefined }), () => false)
  } catch (e) {
    sendDownload({ key, status: 'error', message: e instanceof Error ? e.message : String(e) })
    throw e
  }
  savedFiles.add(res.filePath)
  sendDownload({ key, status: 'done' })
  return res.filePath
})

handle('download:show', (path: string) => {
  if (!savedFiles.has(path)) throw new Error('Only files this app saved can be shown')
  shell.showItemInFolder(path)
})

handle('downloads:list', (entity: DownloadEntity) => {
  if (entity !== 'assets' && entity !== 'asset-grants') throw new Error('Unknown list')
  return listDownloadables(entity)
})
handle('downloads:pickDir', async () => {
  const res = await dialog.showOpenDialog(win!, { title: 'Download assets to', properties: ['openDirectory', 'createDirectory'], defaultPath: getConfig().downloadDir ?? app.getPath('downloads') })
  if (res.canceled || !res.filePaths[0]) return getConfig()
  return updateConfig((cfg) => (cfg.downloadDir = res.filePaths[0]))
})
handle('downloads:extract', (on: boolean) => updateConfig((cfg) => (cfg.downloadExtract = Boolean(on))))
handle('downloads:open', () => {
  const dir = getConfig().downloadDir
  if (!dir) throw new Error('Pick a download folder first')
  return shell.openPath(dir)
})
handle('downloads:start', async (keys: string[]) => {
  if (downloading) throw new Error('A download is already running')
  const { downloadDir, downloadExtract } = getConfig()
  if (!downloadDir) throw new Error('Pick a download folder first')
  downloading = true
  cancelDownloads = false
  try {
    log('download', `bulk ${keys.length} items -> ${downloadDir} extract=${downloadExtract}`)
    return await runDownloads(keys, downloadDir, downloadExtract, sendDownload, () => cancelDownloads)
  } finally {
    downloading = false
  }
})
handle('downloads:cancel', () => {
  cancelDownloads = true
})

// ---------- Folder encryption ----------

const jobOf = (id: string): EncryptJob => {
  const job = getConfig().encryptJobs.find((j) => j.id === id)
  if (!job) throw new Error('This folder pair no longer exists')
  return job
}

handle('encrypt:add', () =>
  updateConfig((cfg) => {
    cfg.encryptJobs.push({ id: randomUUID(), source: '', target: '', assetId: null, assetName: null, lastRun: null })
  })
)
handle('encrypt:remove', (id: string) => updateConfig((cfg) => (cfg.encryptJobs = cfg.encryptJobs.filter((j) => j.id !== id))))
handle('encrypt:pick', async (id: string, which: 'source' | 'target') => {
  if (which !== 'source' && which !== 'target') throw new Error('Bad folder')
  const job = jobOf(id)
  const res = await dialog.showOpenDialog(win!, {
    title: which === 'source' ? 'Folder to encrypt' : 'Folder for the encrypted scripts (everything in it is replaced)',
    defaultPath: job[which] || job.source || undefined,
    properties: ['openDirectory', 'createDirectory']
  })
  if (res.canceled || !res.filePaths[0]) return getConfig()
  const next = { ...job, [which]: res.filePaths[0] }
  const problem = folderProblem(next)
  // A folder still to be picked is fine here; run checks it again.
  if (problem && !/^Pick /.test(problem)) throw new Error(problem)
  return updateConfig((cfg) => {
    cfg.encryptJobs = cfg.encryptJobs.map((j) => (j.id === id ? next : j))
  })
})
handle('encrypt:update', (id: string, patch: { assetId?: number; assetName?: string }) => {
  jobOf(id)
  return updateConfig((cfg) => {
    cfg.encryptJobs = cfg.encryptJobs.map((j) =>
      j.id !== id
        ? j
        : {
            ...j,
            ...(Number.isInteger(patch.assetId) && typeof patch.assetName === 'string' ? { assetId: patch.assetId as number, assetName: patch.assetName } : {})
          }
    )
  })
})
handle('encrypt:open', (id: string, which: 'source' | 'target') => {
  const path = jobOf(id)[which === 'source' ? 'source' : 'target']
  if (!path) throw new Error('No folder picked yet')
  return shell.openPath(path)
})
handle('encrypt:run', async (id: string) => {
  if (pushing) throw new Error('A push or another encryption is already running')
  const job = jobOf(id)
  const previous = ownVersion(job)
  // The first run on an asset publishes the folder to everyone who has the asset, so it is confirmed here, outside the page.
  if (!previous && job.assetId) {
    const { response } = await dialog.showMessageBox(win!, {
      type: 'question',
      buttons: ['Upload', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Escrow',
      message: `Upload ${basename(job.source)} to ${job.assetName ?? `asset ${job.assetId}`}?`,
      detail: 'It becomes a new active version of that asset, and everyone the asset is granted to can download it. Later runs replace only this version.'
    })
    if (response !== 0) return getConfig()
  }
  pushing = true
  cancelPush = false
  // Survives a failed run, so the next one still replaces the version this job uploaded.
  let uploaded = { versionId: previous?.id, version: previous?.version }
  const save = (ok: boolean, message: string): void => {
    updateConfig((cfg) => {
      cfg.encryptJobs = cfg.encryptJobs.map((j) =>
        j.id === id ? { ...j, lastRun: { at: new Date().toISOString(), ok, message, assetId: job.assetId ?? undefined, ...uploaded } } : j
      )
    })
  }
  try {
    log('encrypt', `start ${job.source} -> asset ${job.assetId} -> ${job.target}`)
    const result = await runEncrypt(
      job,
      (p) => {
        if (p.status !== 'running' || p.progress === undefined) log('encrypt', `${p.step} ${p.status}${p.message ? ': ' + p.message : ''}`)
        win?.webContents.send('encrypt:progress', p)
      },
      () => cancelPush,
      (versionId, version) => (uploaded = { versionId, version })
    )
    save(true, result.message)
    return getConfig()
  } catch (e) {
    save(false, e instanceof Error ? e.message : String(e))
    throw e
  } finally {
    pushing = false
  }
})
handle('encrypt:cancel', () => {
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
  if (pushing || downloading) throw new Error('Wait for the push, encryption or download to finish before restarting.')
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
