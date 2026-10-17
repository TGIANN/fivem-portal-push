import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppConfig } from '../shared/types'
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
  update: { apiDefault: false, discordDefault: false, apiUrl: '', tebexToken: '', discordMode: 'webhook', discordChannel: '', roleId: null, allowHere: false, allowEveryone: false },
  secrets: { apiKey: false, botToken: false, webhookUrl: false }
}

let config: AppConfig = defaults

if (existsSync(file)) {
  const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppConfig>
  config = { ...defaults, ...saved, update: { ...defaults.update, ...saved.update } }
}

export function getConfig(): AppConfig {
  config.secrets = secretFlags()
  return config
}

export function updateConfig(patch: (cfg: AppConfig) => void): AppConfig {
  patch(config)
  const { secrets: _, ...saved } = config
  writeFileSync(file, JSON.stringify(saved, null, 2))
  return getConfig()
}
