import { app } from 'electron'
import { join } from 'path'
import type { PushRecord } from '../shared/types'
import { readJsonFile, writeJsonFile } from './jsonFile'

const file = join(app.getPath('userData'), 'history.json')
const maxPerScript = 50

const history = readJsonFile<Record<string, PushRecord[]>>(file) ?? {}

export function addHistory(script: string, record: PushRecord): void {
  history[script] = [record, ...(history[script] ?? [])].slice(0, maxPerScript)
  writeJsonFile(file, history)
}

export const scriptHistory = (script: string): PushRecord[] => history[script] ?? []
