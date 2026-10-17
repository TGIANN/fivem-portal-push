import type { AppConfig, BundleItem, BundleSpec, ChangedFile, DiscordRole, TebexPackage, IgnoreRule, PortalAssetDetail, PushProgress, PushStepId, ScriptInfo, ZipEntry, ZipTree } from '../shared/types'
import type { Api } from './index'

const root = 'D:\\FiveM\\resources\\[tgiann]'

const scripts: [string, string, boolean][] = [
  ['tgiann-hud', '2.3.0', false],
  ['tgiann-drift-school', '1.1.4', false],
  ['tgiann-housing', '3.0.0-b2', true],
  ['tgiann-fishing', '1.6.2', false],
  ['tgiann-jobs', '2.0.1', false],
  ['tgiann-radio', '1.2.0', false],
  ['tgiann-arcade', '1.0.3', false],
  ['tgiann-garage', '2.8.0', true],
  ['tgiann-phone', '1.4.0', true],
  ['tgiann-inventory', '4.1.2', false],
  ['tgiann-elevators', '1.0.0', false],
  ['tgiann-heist', '2.2.5', false]
]

const assets = scripts.map(([name], i) => ({ id: 41200 + i * 37, name }))
const assetFor = (name: string) => assets.find((a) => a.name === name)!

const days = (n: number) => new Date(Date.now() - n * 86400000).toISOString()

const config: AppConfig = {
  roots: [root],
  mappings: Object.fromEntries(
    scripts.filter(([name]) => name !== 'tgiann-arcade').map(([name]) => [name, { assetId: assetFor(name).id, assetName: assetFor(name).name }])
  ),
  lastPush: { 'tgiann-phone': { version: '1.4.0', commit: null, at: days(6) }, 'tgiann-hud': { version: '2.3.0', commit: null, at: days(2) } },
  git: { 'tgiann-phone': true },
  gitDefault: false,
  zipIgnore: ['*.psd'],
  packages: {},
  update: { apiDefault: true, discordDefault: true, apiUrl: 'https://tgiann.com/api/updates', tebexToken: 'demo', discordMode: 'bot', discordChannel: '813192868906532905', roleId: '1133238864895550002', allowHere: true, allowEveryone: false },
  secrets: { apiKey: true, botToken: true, webhookUrl: false }
}

const tebexDemo: TebexPackage[] = scripts.map(([name], i) => ({
  id: 5100000 + i,
  name: name.replace('tgiann-', 'TGIANN ').replace(/-(\w)/g, (_, c: string) => ' ' + c.toUpperCase()).replace(/ (\w)/g, (m) => m.toUpperCase())
}))

const rolesDemo: DiscordRole[] = [
  { id: '1133238864895550001', name: 'Customer', color: 0x36ff9f },
  { id: '1133238864895550002', name: 'Update ping', color: 0xff9230 },
  { id: '1133238864895550003', name: 'Beta testers', color: 0x5865f2 }
]

const versionsFor = (name: string): PortalAssetDetail['versions'] => {
  if (name !== 'tgiann-phone') return [{ id: 1, version: scripts.find((s) => s[0] === name)![1], state: 'active', created_at: days(9), changelog: 'Fixes and improvements', is_release_candidate: false }]
  return [
    { id: 5, version: '1.4.0', state: 'active', created_at: days(6), changelog: 'modified:   client/camera.lua\n+new:       shared/hooks.lua', is_release_candidate: false },
    { id: 4, version: '1.4.0-b2', state: 'active', created_at: days(11), changelog: 'Beta: new camera modes', is_release_candidate: true },
    { id: 3, version: '1.3.2', state: 'active', created_at: days(24), changelog: 'modified:   server/main.lua', is_release_candidate: false },
    { id: 2, version: '1.3.1', state: 'active', created_at: days(40), changelog: 'modified:   configs/config.lua', is_release_candidate: false },
    { id: 1, version: '1.3.0', state: 'active', created_at: days(58), changelog: 'First release on the portal', is_release_candidate: false }
  ]
}

const changes: ChangedFile[] = [
  { status: 'modified', file: 'client/camera.lua' },
  { status: 'modified', file: 'client/main.lua' },
  { status: 'modified', file: 'configs/config.lua' },
  { status: 'modified', file: 'languages/en.lua' },
  { status: 'added', file: 'client/integrations/' },
  { status: 'added', file: 'shared/hooks.lua' },
  { status: 'deleted', file: 'server/legacy.lua' },
  { status: 'modified', file: 'ui/build/index.html' }
]

type Spec = [name: string, size: number | Spec[], excludedBy?: IgnoreRule]

const local = (pattern: string): IgnoreRule => ({ pattern, source: 'local' })

const treeSpec: Spec[] = [
  ['art', [['icons.psd', 4812000, { pattern: '*.psd', source: 'global' }], ['icons.png', 182000]]],
  ['client', [['integrations', [['esx.lua', 3100], ['qb.lua', 2900]]], ['camera.lua', 18400], ['editable.lua', 4200], ['main.lua', 26100]]],
  ['configs', [['config.lua', 9800], ['configServer.lua', 1200]]],
  ['docs', [], local('docs/')],
  ['languages', [['en.lua', 5400], ['tr.lua', 5600]]],
  ['server', [['editable.lua', 2300], ['main.lua', 21800]]],
  ['shared', [['hooks.lua', 1900], ['main.lua', 3300]]],
  ['ui', [['build', [['assets', [['index-4f2a.js', 612000], ['index-9c1d.css', 41000]]], ['index.html', 700]]]]],
  ['.portalignore', 12, { pattern: '.portalignore', source: 'default' }],
  ['fxmanifest.lua', 900],
  ['notes.txt', 640, local('notes.txt')]
]

function zipTree(): ZipTree {
  const entries: ZipEntry[] = []
  const walk = (specs: Spec[], prefix: string, depth: number): { size: number; files: number } => {
    let size = 0
    let files = 0
    for (const [name, content, excludedBy = null] of specs) {
      const path = prefix ? `${prefix}/${name}` : name
      const entry: ZipEntry = { path, name, depth, dir: Array.isArray(content), size: 0, files: 0, excludedBy, scanned: true }
      entries.push(entry)
      if (Array.isArray(content)) {
        if (excludedBy) entry.scanned = false
        else Object.assign(entry, walk(content, path, depth + 1))
      } else {
        entry.size = content
        entry.files = 1
      }
      if (!excludedBy) {
        size += entry.size
        files += entry.files
      }
    }
    return { size, files }
  }
  const total = walk(treeSpec, '', 0)
  const rules: IgnoreRule[] = [{ pattern: '.git/', source: 'default' }, { pattern: '*.psd', source: 'global' }, local('docs/'), local('notes.txt')]
  return { rules, entries, includedFiles: total.files, includedSize: total.size, extras }
}

const demoExtras: BundleItem[] = [
  { source: '../tgiann-core', target: null, path: `${root}\tgiann-core`, name: 'tgiann-core', dir: true, files: 14, size: 86200, error: null },
  { source: '../docs/INSTALL.md', target: null, path: 'D:\FiveM\resources\docs\INSTALL.md', name: 'INSTALL.md', dir: false, files: 1, size: 2100, error: null }
]

let extras: BundleItem[] = [demoExtras[1]]

function setBundle(specs: BundleSpec[]): void {
  extras = specs.flatMap((s) => {
    const item = demoExtras.find((d) => d.source === s.source)
    if (!item) return []
    return [{ ...item, target: s.target, name: s.target ?? item.source.split('/').pop()! }]
  })
}

const listeners = new Set<(p: PushProgress) => void>()
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function push(): Promise<void> {
  const emit = (step: PushStepId, status: PushProgress['status'], message?: string, progress?: number) => listeners.forEach((cb) => cb({ step, status, message, progress }))
  const steps: [PushStepId, string][] = [
    ['manifest', '1.4.0 → 1.4.1'],
    ['zip', '27 files, 0.91 MB'],
    ['versions', 'Deleted oldest version 1.3.0'],
    ['upload', 'Uploaded'],
    ['process', 'Active on portal'],
    ['update', 'Posted to tgiann.com and Discord'],
    ['git', 'Pushed']
  ]
  for (const [step, message] of steps) {
    emit(step, 'running')
    await wait(250)
    emit(step, 'done', message, step === 'upload' ? 1 : undefined)
  }
}

export const demoApi: Api = {
  getConfig: async () => config,
  addRoot: async () => config,
  removeRoot: async () => config,
  scanScripts: async () =>
    scripts.map(([name, version, dirty]): ScriptInfo => ({ name, path: `${root}\\${name}`, root, version, gitRoot: 'D:\\FiveM', dirty })),
  checkAuth: async () => ({ ok: true, reason: null }),
  login: async () => true,
  logout: async () => undefined,
  browserLogin: async () => true,
  cancelBrowserLogin: async () => undefined,
  openExtensionFolder: async () => '',
  listAssets: async (search) => assets.filter((a) => a.name.includes(search.toLowerCase())),
  assetDetail: async (id) => {
    const asset = assets.find((a) => a.id === id)!
    return { id, name: asset.name, state: 'active', versions: versionsFor(asset.name) }
  },
  gitChanges: async (path) => (path.endsWith('tgiann-phone') ? { since: 'demo', files: changes } : { since: 'demo', files: [] }),
  zipTree: async () => zipTree(),
  setLocalIgnore: async () => undefined,
  setGlobalIgnore: async () => config,
  setBundle: async (_, specs) => setBundle(specs),
  addToBundle: async () => setBundle([...extras, ...demoExtras.filter((d) => !extras.some((e) => e.source === d.source))]),
  setUpdateSettings: async (patch) => {
    config.update = { ...config.update, ...patch }
    return { ...config }
  },
  setSecret: async (name, value) => {
    config.secrets = { ...config.secrets, [name]: Boolean(value) }
    return { ...config }
  },
  checkUpdateTarget: async (target) => (target === 'tebex' ? `${tebexDemo.length} packages found` : target === 'api' ? 'Connected to TGIANN Store' : 'Connected to #updates, 3 roles'),
  tebexPackages: async () => tebexDemo,
  discordRoles: async () => rolesDemo,
  pickImages: async () => [],
  postUpdate: async () => 'Posted to tgiann.com and Discord',
  setGitDefault: async (value) => {
    config.gitDefault = value
    config.git = {}
    return { ...config }
  },
  push,
  openPath: async () => '',
  openLog: async () => '',
  onPushProgress: (cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  onOpenScript: () => () => undefined
}
