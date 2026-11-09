import { createHash } from 'crypto'
import { existsSync, readFileSync, statSync } from 'fs'
import { readFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import picomatch from 'picomatch'
import type { ManifestIssue, ScriptChecks, SecretFinding } from '../shared/types'
import { resolveBundle } from './bundle'
import { includedFiles } from './ignore'
import { getConfig } from './store'

// ---------- Secrets ----------

const textFiles = new Set(['.lua', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.json', '.cfg', '.ini', '.toml', '.yml', '.yaml', '.xml', '.html', '.htm', '.md', '.txt', '.sql', '.sh', '.bat', '.ps1', '.py', '.cs', '.conf', '.env'])
const maxFileSize = 5 * 1024 * 1024
const maxPerFile = 5
const maxFindings = 200
const readBatch = 32

interface Rule {
  kind: string
  pattern: RegExp
  /** The capture group that holds the secret; the whole match when left out. */
  group?: number
}

// Formats that are not mistaken for anything else. One of these stops the push.
const sureRules: Rule[] = [
  { kind: 'Discord webhook', pattern: /https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d{5,}\/[\w-]{20,}/g },
  { kind: 'Discord bot token', pattern: /\b[MNO][\w-]{23,27}\.[\w-]{6}\.[\w-]{27,}\b/g },
  { kind: 'Slack webhook', pattern: /https:\/\/hooks\.slack\.com\/services\/[\w/-]{20,}/g },
  { kind: 'Steam API key', pattern: /steam_?web_?api_?key[\s"'=:]*([0-9a-f]{32})\b/gi, group: 1 },
  { kind: 'Cfx license key', pattern: /\bcfxk_[A-Za-z0-9_-]{20,}/g },
  { kind: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{40,})\b/g },
  { kind: 'AWS key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'Google API key', pattern: /\bAIza[\w-]{35}\b/g },
  { kind: 'AI API key', pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { kind: 'Stripe key', pattern: /\b[rs]k_live_[A-Za-z0-9]{20,}\b/g },
  { kind: 'Private key', pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g },
  { kind: 'Database password', pattern: /\bmysql:\/\/[^\s:'"@/]+:([^\s'"@/]+)@/gi, group: 1 },
  { kind: 'Database password', pattern: /(?:server|host)=[^;'"\n]{1,100};[^'"\n]{0,200}?(?:password|pwd)=([^;'"\n]+)/gi, group: 1 }
]

// A name that sounds secret with a value that looks like one. Only a warning.
const maybeRule: Rule = { kind: 'Possible secret', pattern: /(?:api[_-]?key|secret|token|password|passwd)[\w-]{0,30}["'`]?\s*[:=]\s*["'`]([^"'`\n]{12,200})["'`]/gi, group: 1 }

const placeholder = /^(?:your|change|example|sample|xxx|todo|placeholder|insert|put|enter|<|\{|\$|%)|^(?:test|none|null|nil|password|pass|root|secret|token)$/i

function looksReal(value: string): boolean {
  return !/\s/.test(value) && /[a-z]/i.test(value) && /\d/.test(value)
}

function mask(value: string): string {
  const bare = value.replace(/^https?:\/\//, '')
  return bare.length <= 16 ? '••••' : `${bare.slice(0, 6)}••••${bare.slice(-2)}`
}

function scanText(text: string, { name: file, own }: ScanFile, skipMaybe: boolean, sink: Map<string, SecretFinding>, allowed: Set<string>): void {
  const lineStarts: number[] = [0]
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1)
  const lineOf = (index: number): number => {
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (lineStarts[mid] <= index) low = mid
      else high = mid - 1
    }
    return low + 1
  }

  let found = 0
  const rules = skipMaybe ? sureRules : [...sureRules, maybeRule]
  for (const rule of rules) {
    const sure = rule !== maybeRule
    for (const m of text.matchAll(rule.pattern)) {
      if (found >= maxPerFile) return
      const value = m[rule.group ?? 0]
      if (rule.group !== undefined && (placeholder.test(value) || (!sure && !looksReal(value)))) continue
      const id = createHash('sha256').update(`${file}\0${rule.kind}\0${value}`).digest('hex').slice(0, 16)
      if (sink.has(id)) continue
      sink.set(id, { id, file, line: lineOf(m.index), kind: rule.kind, sure, preview: mask(value), allowed: allowed.has(id), own })
      found++
    }
  }
}

interface ScanFile {
  abs: string
  /** The path inside the zip, or inside the script for the script's own files. */
  name: string
  own: boolean
}

// ---------- fxmanifest ----------

const stringsAndComments = /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|--\[\[[\s\S]*?\]\]|--[^\n]*/g
const directive = /^[ \t]*(client_scripts?|server_scripts?|shared_scripts?|files?|ui_page|loadscreen)\b[ \t]*\(?\s*(\{[^}]*\}|"[^"]*"|'[^']*')/gm

export function manifestEntries(source: string): { directive: string; entry: string }[] {
  const clean = source.replace(stringsAndComments, (_, text: string | undefined) => text ?? '')
  const out: { directive: string; entry: string }[] = []
  for (const m of clean.matchAll(directive)) {
    for (const s of m[2].matchAll(/"([^"]*)"|'([^']*)'/g)) {
      const entry = (s[1] ?? s[2]).trim().replace(/\\/g, '/').replace(/^\.\//, '')
      // "@other/file.lua" lives in another resource.
      if (entry && !entry.startsWith('@') && !/^[a-z]+:\/\//i.test(entry)) out.push({ directive: m[1], entry })
    }
  }
  return out
}

function checkManifest(dir: string, zipped: string[]): ManifestIssue[] {
  const exact = new Set(zipped)
  const byLowerCase = new Map(zipped.map((p) => [p.toLowerCase(), p]))
  const issues: ManifestIssue[] = []

  for (const { directive: name, entry } of manifestEntries(readFileSync(join(dir, 'fxmanifest.lua'), 'utf8'))) {
    if (/[*?[{]/.test(entry)) {
      // FiveM also walks subfolders for "folder/**.lua".
      const isMatch = picomatch(entry.replace(/\*\*(?!\/)/g, '**/*'))
      if (!zipped.some((p) => isMatch(p))) issues.push({ directive: name, entry, problem: 'Matches no file in the zip' })
      continue
    }
    if (exact.has(entry)) continue
    const other = byLowerCase.get(entry.toLowerCase())
    const onDisk = !entry.split('/').includes('..') && existsSync(join(dir, entry))
    if (other) issues.push({ directive: name, entry, problem: `The file is ${other}. Upper and lower case differ, so Linux servers will not find it` })
    else if (onDisk && statSync(join(dir, entry)).isDirectory()) continue
    else if (onDisk) issues.push({ directive: name, entry, problem: 'A zip rule keeps this file out' })
    else issues.push({ directive: name, entry, problem: 'File not found' })
  }
  return issues
}

// ---------- Together ----------

export async function runChecks(dir: string): Promise<ScriptChecks> {
  const script = basename(dir)
  const config = getConfig()
  const allowed = new Set(config.secretAllow[script] ?? [])
  // Generated bundles are full of names like "token" that mean nothing.
  const buildPrefixes = config.buildDirs.map((d) => `${d.toLowerCase()}/`)
  const isBuild = (rel: string): boolean => buildPrefixes.some((p) => rel.toLowerCase().startsWith(p)) || /\.min\.\w+$/i.test(rel)

  const own = await includedFiles(dir)
  const files: ScanFile[] = own.map((f) => ({ abs: f.abs, name: f.rel, own: true }))
  for (const item of await resolveBundle(dir)) {
    if (item.error) continue
    if (item.dir) files.push(...(await includedFiles(item.path)).map((f) => ({ abs: f.abs, name: `${item.name}/${f.rel}`, own: false })))
    else files.push({ abs: item.path, name: item.name, own: false })
  }

  const texts = files.filter((f) => textFiles.has(extname(f.name).toLowerCase()) || basename(f.name).toLowerCase() === 'fxmanifest.lua')
  const sink = new Map<string, SecretFinding>()
  for (let i = 0; i < texts.length && sink.size < maxFindings; i += readBatch) {
    const batch = texts.slice(i, i + readBatch)
    const contents = await Promise.all(batch.map((f) => (statSync(f.abs).size > maxFileSize ? null : readFile(f.abs, 'utf8').catch(() => null))))
    for (const [n, text] of contents.entries()) {
      if (text !== null) scanText(text, batch[n], isBuild(batch[n].name), sink, allowed)
    }
    await new Promise(setImmediate)
  }

  const secrets = [...sink.values()].sort((a, b) => Number(b.sure) - Number(a.sure) || a.file.localeCompare(b.file) || a.line - b.line)
  return { secrets, manifest: checkManifest(dir, own.map((f) => f.rel)), scanned: texts.length }
}
