import { existsSync, readFileSync } from 'fs'
import { readdir, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import picomatch from 'picomatch'
import type { IgnoreRule, ZipEntry, ZipTree } from '../shared/types'
import { bundleFile, resolveBundle, secretPatterns } from './bundle'
import { getConfig } from './store'

export const ignoreFile = '.portalignore'

export const defaultIgnore = [
  '.git/',
  '.github/',
  '.vscode/',
  '.idea/',
  'node_modules/',
  '*.zip',
  ignoreFile,
  bundleFile,
  '.gitignore',
  '.DS_Store',
  'Thumbs.db',
  ...secretPatterns.filter((p) => p !== '.git')
]

function readLines(dir: string): string[] {
  const file = join(dir, ignoreFile)
  return existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : []
}

export function readLocalPatterns(dir: string): string[] {
  return readLines(dir)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

export async function writeLocalPatterns(dir: string, patterns: string[]): Promise<void> {
  const comments = readLines(dir).filter((l) => l.trim().startsWith('#'))
  const unique = [...new Set(patterns.map((p) => p.trim()).filter(Boolean))]
  await writeFile(join(dir, ignoreFile), [...comments, ...unique].join('\n') + '\n')
}

export function ignoreRules(dir: string): IgnoreRule[] {
  return [
    ...defaultIgnore.map((pattern) => ({ pattern, source: 'default' as const })),
    ...(getConfig().zipIgnore ?? []).map((pattern) => ({ pattern, source: 'global' as const })),
    ...readLocalPatterns(dir).map((pattern) => ({ pattern, source: 'local' as const }))
  ]
}

// Windows and macOS file names ignore case, so "Server.CFG" must match server.cfg.
const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin'

export type IgnoreMatcher = (relPath: string, isDir: boolean) => IgnoreRule | null

export function compileRules(rules: IgnoreRule[]): IgnoreMatcher {
  const compiled = rules.map((rule) => {
    let p = rule.pattern.replace(/\\/g, '/').replace(/^\//, '')
    const dirOnly = p.endsWith('/')
    if (dirOnly) p = p.slice(0, -1)
    const isMatch = picomatch(p, { dot: true, basename: !p.includes('/'), nocase: caseInsensitive })
    return { rule, dirOnly, isMatch }
  })

  return (relPath, isDir) => {
    for (const c of compiled) {
      if (c.dirOnly && !isDir) continue
      if (c.isMatch(relPath)) return c.rule
    }
    return null
  }
}

const batch = 500

/** Every file of a folder that goes into the zip, with its path inside that folder. */
export async function includedFiles(root: string): Promise<{ abs: string; rel: string }[]> {
  const ignored = compileRules(ignoreRules(root))
  const out: { abs: string; rel: string }[] = []
  async function walk(abs: string, rel: string): Promise<void> {
    for (const [i, entry] of (await readdir(abs, { withFileTypes: true })).entries()) {
      if (i % batch === batch - 1) await new Promise(setImmediate)
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!ignored(relPath, true)) await walk(join(abs, entry.name), relPath)
      } else if (entry.isFile() && !ignored(relPath, false)) {
        out.push({ abs: join(abs, entry.name), rel: relPath })
      }
    }
  }
  await walk(root, '')
  return out
}

async function scanDir(dir: string, match: IgnoreMatcher): Promise<{ entries: ZipEntry[]; size: number; files: number }> {
  const entries: ZipEntry[] = []

  async function walk(abs: string, rel: string, depth: number): Promise<{ size: number; files: number }> {
    let size = 0
    let files = 0
    const list = await readdir(abs, { withFileTypes: true })
    list.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    const sizes: number[] = []
    for (let i = 0; i < list.length; i += batch) {
      sizes.push(...(await Promise.all(list.slice(i, i + batch).map((e) => (e.isFile() ? stat(join(abs, e.name)).then((s) => s.size) : 0)))))
    }

    for (const [i, e] of list.entries()) {
      // A folder with tens of thousands of files must not freeze the window.
      if (i % batch === batch - 1) await new Promise(setImmediate)
      if (!e.isDirectory() && !e.isFile()) continue
      const path = rel ? `${rel}/${e.name}` : e.name
      const excludedBy = match(path, e.isDirectory())
      const entry: ZipEntry = { path, name: e.name, depth, dir: e.isDirectory(), size: 0, files: 0, excludedBy, scanned: true }
      entries.push(entry)

      if (e.isDirectory()) {
        if (excludedBy) {
          entry.scanned = false
          continue
        }
        const sub = await walk(join(abs, e.name), path, depth + 1)
        entry.size = sub.size
        entry.files = sub.files
      } else {
        entry.size = sizes[i]
        entry.files = 1
      }

      if (!excludedBy) {
        size += entry.size
        files += entry.files
      }
    }
    return { size, files }
  }

  const total = await walk(dir, '', 0)
  return { entries, ...total }
}

export async function zipTree(dir: string): Promise<ZipTree> {
  const rules = ignoreRules(dir)
  const main = await scanDir(dir, compileRules(rules))

  const extras = await resolveBundle(dir)
  for (const item of extras) {
    if (item.error) continue
    try {
      if (item.dir) {
        const sub = await scanDir(item.path, compileRules(ignoreRules(item.path)))
        item.size = sub.size
        item.files = sub.files
      } else {
        item.size = (await stat(item.path)).size
        item.files = 1
      }
    } catch (e) {
      item.error = e instanceof Error ? e.message : String(e)
    }
  }

  return { rules, entries: main.entries, includedFiles: main.files, includedSize: main.size, extras }
}

export function isExcluded(match: IgnoreMatcher, relPath: string): boolean {
  const isDir = relPath.endsWith('/')
  const parts = relPath.replace(/\/$/, '').split('/')
  for (let i = 1; i < parts.length; i++) if (match(parts.slice(0, i).join('/'), true)) return true
  return match(parts.join('/'), isDir) !== null
}
