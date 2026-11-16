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

/** One downloadable file of a version. game is "gta5", "rdr3", or "" for both. */
export interface PortalPack {
  id: number
  game: string
}

export interface PortalVersion {
  id: number
  version: string
  state: string
  created_at: string
  changelog: string
  is_release_candidate: boolean
  packs?: PortalPack[]
}

/** Your own assets download through "assets", the ones granted to you through "asset-grants". */
export type DownloadEntity = 'assets' | 'asset-grants'

/** An asset in the bulk download list, with the version a download would fetch. */
export interface Downloadable {
  /** `${entity}:${entityId}`, also what a download request sends back. */
  key: string
  entity: DownloadEntity
  entityId: number
  name: string
  author: string | null
  /** Granted assets list their versions without numbers; the number is known once one is downloaded. */
  version: string | null
  updatedAt: string | null
  /** When the asset was granted to you. Only granted assets have it. */
  receivedAt: string | null
  /** Changed on the portal since your last download. Only granted assets report it. */
  updated: boolean
  /** Why it can not be downloaded right now, or null. */
  unavailable: string | null
}

export interface DownloadProgress {
  key: string
  status: 'running' | 'done' | 'error'
  message?: string
  progress?: number
  /** The version being downloaded, once known. */
  version?: string
}

export interface EncryptRun {
  at: string
  ok: boolean
  message: string
  /** The portal version the run uploaded, and where; only that version is replaced by the next run. */
  version?: string
  assetId?: number
  versionId?: number
}

/** A folder of scripts sent through the portal for encryption, then unpacked into another folder. */
export interface EncryptJob {
  id: string
  source: string
  target: string
  assetId: number | null
  assetName: string | null
  lastRun: EncryptRun | null
}

export type EncryptStepId = 'scan' | 'zip' | 'versions' | 'upload' | 'process' | 'download' | 'extract'

export interface EncryptProgress {
  jobId: string
  step: EncryptStepId
  status: PushStepStatus
  message?: string
  progress?: number
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
  encryptJobs: EncryptJob[]
  /** Where bulk downloads go. */
  downloadDir: string | null
  /** Unpack bulk downloads into folders instead of keeping the zips. */
  downloadExtract: boolean
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
