import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { log } from './log'

/** A file that can not be parsed is moved aside, so a broken save never stops the app from starting. */
export function readJsonFile<T>(file: string): T | null {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch (e) {
    log('store', `${file} is broken, moving it aside: ${e instanceof Error ? e.message : String(e)}`)
    try {
      renameSync(file, `${file}.broken`)
    } catch {
      // Still unreadable next time; the app starts anyway.
    }
    return null
  }
}

/** Writes next to the file and swaps it in, so a crash or power cut mid-save leaves the old file whole. */
export function writeJsonFile(file: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2)
  const temp = `${file}.tmp`
  writeFileSync(temp, text)
  try {
    renameSync(temp, file)
  } catch {
    // Antivirus can hold the file for a moment on Windows.
    writeFileSync(file, text)
    rmSync(temp, { force: true })
  }
}
