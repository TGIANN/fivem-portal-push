import { contextBridge, ipcRenderer } from 'electron'
import { demoApi } from './demo'
import type {
  AppConfig,
  AppUpdateState,
  BundleSpec,
  ChangedFile,
  DiscordRole,
  DownloadEntity,
  DownloadProgress,
  Downloadable,
  EncryptProgress,
  PortalAsset,
  PortalAssetDetail,
  PushProgress,
  PushRecord,
  PushRequest,
  ScriptChecks,
  ScriptInfo,
  SecretName,
  TebexPackage,
  UpdateImage,
  UpdatePost,
  UpdateSettings,
  UpdateTarget,
  ZipTree
} from '../shared/types'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = await ipcRenderer.invoke(channel, ...args)
  if (!res.ok) throw Object.assign(new Error(res.error), { auth: res.auth })
  return res.data as T
}

function on<T>(channel: string, cb: (data: T) => void): () => void {
  const listener = (_: unknown, data: T): void => cb(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  getConfig: () => call<AppConfig>('config:get'),
  addRoot: () => call<AppConfig>('roots:add'),
  removeRoot: (root: string) => call<AppConfig>('roots:remove', root),
  scanScripts: () => call<ScriptInfo[]>('scripts:scan'),
  checkAuth: () => call<{ ok: boolean; reason: string | null }>('auth:check'),
  login: () => call<boolean>('auth:login'),
  logout: () => call<void>('auth:logout'),
  browserLogin: () => call<boolean>('auth:browserLogin'),
  cancelBrowserLogin: () => call<void>('auth:cancelBrowserLogin'),
  openExtensionFolder: () => call<string>('extension:open'),
  listAssets: (search: string) => call<PortalAsset[]>('portal:assets', search),
  assetDetail: (id: number) => call<PortalAssetDetail>('portal:detail', id),
  gitChanges: (scriptPath: string) => call<{ since: string | null; files: ChangedFile[] } | null>('git:changes', scriptPath),
  zipTree: (scriptPath: string) => call<ZipTree>('zip:tree', scriptPath),
  setLocalIgnore: (scriptPath: string, patterns: string[]) => call<void>('ignore:setLocal', scriptPath, patterns),
  setGlobalIgnore: (patterns: string[]) => call<AppConfig>('ignore:setGlobal', patterns),
  setBundle: (scriptPath: string, specs: BundleSpec[]) => call<void>('bundle:set', scriptPath, specs),
  addToBundle: (scriptPath: string, kind: 'folder' | 'file') => call<void>('bundle:add', scriptPath, kind),
  setUpdateSettings: (patch: Partial<UpdateSettings>) => call<AppConfig>('settings:update', patch),
  setSecret: (name: SecretName, value: string | null) => call<AppConfig>('settings:secret', name, value),
  checkUpdateTarget: (target: UpdateTarget) => call<string>('update:check', target),
  tebexPackages: (refresh = false) => call<TebexPackage[]>('tebex:packages', refresh),
  discordRoles: (refresh = false) => call<DiscordRole[]>('discord:roles', refresh),
  apiRoles: (refresh = false) => call<DiscordRole[]>('update:apiRoles', refresh),
  pickImages: () => call<UpdateImage[]>('images:pick'),
  postUpdate: (scriptPath: string, version: string, post: UpdatePost) => call<string>('update:post', scriptPath, version, post),
  setGitDefault: (value: boolean) => call<AppConfig>('settings:gitDefault', value),
  setBuildDirs: (dirs: string[]) => call<AppConfig>('settings:buildDirs', dirs),
  rememberUpdate: (scriptPath: string, patch: { package?: TebexPackage; roleId?: string | null }) => call<AppConfig>('script:remember', scriptPath, patch),
  getAppUpdate: () => call<AppUpdateState>('appUpdate:get'),
  checkAppUpdate: () => call<void>('appUpdate:check'),
  downloadAppUpdate: () => call<void>('appUpdate:download'),
  installAppUpdate: () => call<void>('appUpdate:install'),
  onAppUpdate: (cb: (s: AppUpdateState) => void) => on('appUpdate:state', cb),
  push: (req: PushRequest) => call<void>('push:start', req),
  cancelPush: () => call<void>('push:cancel'),
  runChecks: (scriptPath: string) => call<ScriptChecks>('checks:run', scriptPath),
  allowSecret: (scriptPath: string, id: string, allowed: boolean) => call<AppConfig>('checks:allow', scriptPath, id, allowed),
  pushHistory: (scriptPath: string) => call<PushRecord[]>('history:get', scriptPath),
  openPath: (path: string) => call<string>('shell:open', path),
  openLog: () => call<string>('log:open'),
  onPushProgress: (cb: (p: PushProgress) => void) => on('push:progress', cb),
  downloadVersion: (assetId: number, versionId: number) => call<string | null>('portal:downloadVersion', assetId, versionId),
  showDownloaded: (path: string) => call<void>('download:show', path),
  listDownloadables: (entity: DownloadEntity) => call<Downloadable[]>('downloads:list', entity),
  grantVersions: (keys: string[]) => call<Record<string, string | null>>('downloads:versions', keys),
  pickDownloadDir: () => call<AppConfig>('downloads:pickDir'),
  setDownloadExtract: (on: boolean) => call<AppConfig>('downloads:extract', on),
  openDownloadDir: () => call<string>('downloads:open'),
  startDownloads: (keys: string[]) => call<{ done: number; failed: number }>('downloads:start', keys),
  cancelDownloads: () => call<void>('downloads:cancel'),
  onDownloadProgress: (cb: (p: DownloadProgress) => void) => on('download:progress', cb),
  addEncryptJob: () => call<AppConfig>('encrypt:add'),
  removeEncryptJob: (id: string) => call<AppConfig>('encrypt:remove', id),
  pickEncryptFolder: (id: string, which: 'source' | 'target') => call<AppConfig>('encrypt:pick', id, which),
  updateEncryptJob: (id: string, patch: { assetId?: number; assetName?: string }) => call<AppConfig>('encrypt:update', id, patch),
  openEncryptFolder: (id: string, which: 'source' | 'target') => call<string>('encrypt:open', id, which),
  runEncryptJob: (id: string) => call<AppConfig>('encrypt:run', id),
  cancelEncryptJob: () => call<void>('encrypt:cancel'),
  onEncryptProgress: (cb: (p: EncryptProgress) => void) => on('encrypt:progress', cb),
  onOpenScript: (cb: (path: string) => void) => on('script:open', cb)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', process.argv.includes('--portal-push-demo') ? demoApi : api)
