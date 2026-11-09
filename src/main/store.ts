import { app } from 'electron'
import { join } from 'path'
import { defaultBuildDirs } from '../shared/buildDirs'
import type { AppConfig } from '../shared/types'
import { readJsonFile, writeJsonFile } from './jsonFile'
import { secretFlags } from './secrets'

const file = join(app.getPath('userData'), 'config.json')

const defaults: AppConfig = {
  roots: [],
  mappings: {},
  lastPush: {},
  git: {},
  gitDefault: false,
  zipIgnore: [],
  packages: {},
  roles: {},
  secretAllow: {},
  buildDirs: defaultBuildDirs,
  update: { apiDefault: false, discordDefault: false, apiUrl: '', tebexToken: '', discordMode: 'webhook', discordChannel: '', roleId: null, allowHere: false, allowEveryone: false, apiAnnounces: false },
  secrets: { apiKey: false, botToken: false, webhookUrl: false }
}

let config: AppConfig = defaults

const saved = readJsonFile<Partial<AppConfig>>(file)
if (saved) config = { ...defaults, ...saved, update: { ...defaults.update, ...saved.update } }

export function getConfig(): AppConfig {
  config.secrets = secretFlags()
  return config
}

export function updateConfig(patch: (cfg: AppConfig) => void): AppConfig {
  patch(config)
  const { secrets: _, ...saved } = config
  writeJsonFile(file, saved)
  return getConfig()
}
