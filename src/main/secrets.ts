import { app, safeStorage } from 'electron'
import { join } from 'path'
import type { SecretName } from '../shared/types'
import { readJsonFile, writeJsonFile } from './jsonFile'

// Tokens and keys live apart from config.json, encrypted with the OS keychain
// (DPAPI on Windows); nothing is saved when encryption is not available.
// The renderer only sees which ones are set.
const file = join(app.getPath('userData'), 'secrets.json')
const names: SecretName[] = ['apiKey', 'botToken', 'webhookUrl']

let data: Partial<Record<SecretName, string>> = readJsonFile(file) ?? {}

export function getSecret(name: SecretName): string | null {
  const value = data[name]
  if (!value) return null
  if (value.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
  return value.replace(/^plain:/, '')
}

export function setSecret(name: SecretName, value: string | null): void {
  const clean = value?.trim()
  data = { ...data }
  if (!clean) delete data[name]
  else if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows can not encrypt secrets for this account right now, so the value was not saved.')
  else data[name] = 'enc:' + safeStorage.encryptString(clean).toString('base64')
  writeJsonFile(file, data)
}

export function secretFlags(): Record<SecretName, boolean> {
  return Object.fromEntries(names.map((n) => [n, Boolean(data[n])])) as Record<SecretName, boolean>
}
