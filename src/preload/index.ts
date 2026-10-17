import { contextBridge, ipcRenderer } from 'electron'
import { demoApi } from './demo'
import type {
  AppConfig,
  BundleSpec,
  ChangedFile,
  DiscordRole,
  PortalAsset,
  PortalAssetDetail,
  PushProgress,
  PushRequest,
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
  push: (req: PushRequest) => call<void>('push:start', req),
  openPath: (path: string) => call<string>('shell:open', path),
  openLog: () => call<string>('log:open'),
  onPushProgress: (cb: (p: PushProgress) => void) => on('push:progress', cb),
  onOpenScript: (cb: (path: string) => void) => on('script:open', cb)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', process.argv.includes('--portal-push-demo') ? demoApi : api)
