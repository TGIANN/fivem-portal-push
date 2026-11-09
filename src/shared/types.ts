export interface ScriptInfo {
  name: string
  path: string
  root: string
  version: string | null
  gitRoot: string | null
  dirty: boolean
}

export interface PortalAsset {
  id: number
  name: string
}

export interface PortalVersion {
  id: number
  version: string
  state: string
  created_at: string
  changelog: string
  is_release_candidate: boolean
}

export interface PortalAssetDetail {
  id: number
  name: string
  state: string
  versions: PortalVersion[]
}

export interface AssetMapping {
  assetId: number
  assetName: string
}

export interface LastPush {
  version: string
  commit: string | null
  at: string
}

export type DiscordMode = 'webhook' | 'bot'
export type SecretName = 'apiKey' | 'botToken' | 'webhookUrl'

export interface UpdateSettings {
  apiDefault: boolean
  discordDefault: boolean
  apiUrl: string
  tebexToken: string
  discordMode: DiscordMode
  discordChannel: string
  /** A role ID, or "here" / "everyone" when those are allowed below. */
  roleId: string | null
  allowHere: boolean
  allowEveryone: boolean
  /** The update API posts the Discord announcement itself (GET /roles, POST /<id>/announce). */
  apiAnnounces: boolean
}

export interface TebexPackage {
  id: number
  name: string
}

export interface DiscordRole {
  id: string
  name: string
  color: number
}

export interface UpdateImage {
  path: string
  name: string
  size: number
  thumb: string
}

export interface UpdatePost {
  api: boolean
  discord: boolean
  package: TebexPackage | null
  roleId: string | null
  /** Ask the update API to post the Discord announcement after the images. */
  apiAnnounce: boolean
  notes: string
  changedFiles: string
  images: string[]
}

export type UpdateTarget = 'api' | 'discord' | 'tebex'

export interface AppConfig {
  roots: string[]
  mappings: Record<string, AssetMapping>
  lastPush: Record<string, LastPush>
  git: Record<string, boolean>
  gitDefault: boolean
  zipIgnore: string[]
  packages: Record<string, TebexPackage>
  /** The tag picked for each script. null means "No tag"; a script without an entry starts with update.roleId. */
  roles: Record<string, string | null>
  /** Findings of the secret check the user marked as fine, per script. */
  secretAllow: Record<string, string[]>
  /** Folders that show as one line in the changelog, relative to the script. */
  buildDirs: string[]
  update: UpdateSettings
  /** Which secrets are saved. The values never leave the main process. */
  secrets: Record<SecretName, boolean>
}

export type IgnoreSource = 'default' | 'global' | 'local'

export interface IgnoreRule {
  pattern: string
  source: IgnoreSource
}

export interface ZipEntry {
  path: string
  name: string
  depth: number
  dir: boolean
  size: number
  files: number
  excludedBy: IgnoreRule | null
  scanned: boolean
}

export interface BundleSpec {
  source: string
  target: string | null
}

export interface BundleItem extends BundleSpec {
  path: string
  name: string
  dir: boolean
  files: number
  size: number
  error: string | null
}

export interface ZipTree {
  rules: IgnoreRule[]
  entries: ZipEntry[]
  includedFiles: number
  includedSize: number
  extras: BundleItem[]
}

export type AuthState = 'unknown' | 'checking' | 'loggedIn' | 'loggedOut'

export interface PushRequest {
  scriptPath: string
  assetId: number
  assetName: string
  version: string
  changelog: string
  git: boolean
  update: UpdatePost | null
  /** Delete the portal version with this number first, then upload under the same number. */
  replace: boolean
}

export type PushStepId = 'manifest' | 'zip' | 'versions' | 'upload' | 'process' | 'update' | 'git'
export type PushStepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error'

export interface PushProgress {
  step: PushStepId
  status: PushStepStatus
  message?: string
  progress?: number
}

export interface PushResult {
  ok: boolean
  error?: string
}

export interface SecretFinding {
  /** False for extra content, which .portalignore of the script does not cover. */
  own: boolean
  id: string
  file: string
  line: number
  kind: string
  /** A format that can only be a secret. These stop the push until allowed. */
  sure: boolean
  /** Masked. The real value never leaves the main process. */
  preview: string
  allowed: boolean
}

export interface ManifestIssue {
  directive: string
  entry: string
  problem: string
}

export interface ScriptChecks {
  secrets: SecretFinding[]
  manifest: ManifestIssue[]
  scanned: number
}

export interface PushRecord {
  at: string
  version: string
  assetName: string
  files: number
  size: number
  seconds: number
  replaced: boolean
  outcome: 'live' | 'failed' | 'cancelled'
  message: string | null
}

export type AppUpdateStatus = 'unsupported' | 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error'

export interface AppUpdateState {
  status: AppUpdateStatus
  current: string
  version: string | null
  notes: string
  percent: number
  portable: boolean
  error: string | null
}

export interface ChangedFile {
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  file: string
}
