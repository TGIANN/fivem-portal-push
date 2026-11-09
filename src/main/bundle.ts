import { app } from 'electron'
import { existsSync, readFileSync, realpathSync, statSync } from 'fs'
import { rm, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { basename, isAbsolute, join, relative, resolve } from 'path'
import picomatch from 'picomatch'
import type { BundleItem, BundleSpec } from '../shared/types'
import { gitRoot } from './git'
import { getConfig } from './store'

export const bundleFile = '.portalbundle'

const arrow = ' -> '

function readLines(dir: string): string[] {
  const file = join(dir, bundleFile)
  return existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : []
}

export function readBundle(dir: string): BundleSpec[] {
  return readLines(dir)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf(arrow)
      return i === -1 ? { source: l, target: null } : { source: l.slice(0, i).trim(), target: l.slice(i + arrow.length).trim() || null }
    })
}

export async function writeBundle(dir: string, specs: BundleSpec[]): Promise<void> {
  const file = join(dir, bundleFile)
  const comments = readLines(dir).filter((l) => l.trim().startsWith('#'))
  const lines = specs
    .map((s) => ({ source: s.source.trim().replace(/\\/g, '/'), target: s.target?.trim().replace(/\\/g, '/') || null }))
    .filter((s) => s.source)
    .map((s) => (s.target && s.target !== defaultName(s.source) ? `${s.source}${arrow}${s.target}` : s.source))
  if (lines.length === 0 && comments.length === 0) {
    await rm(file, { force: true })
    return
  }
  await writeFile(file, [...comments, ...lines].join('\n') + '\n')
}

/** Path saved in .portalbundle for a picked file: relative to the script when it can be, absolute otherwise. */
export function toSource(dir: string, picked: string): string {
  const rel = relative(dir, picked)
  return (isAbsolute(rel) ? picked : rel).replace(/\\/g, '/')
}

function defaultName(source: string): string {
  return basename(source.replace(/[\\/]+$/, ''))
}

export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function realpath(p: string): string {
  try {
    return realpathSync.native(p)
  } catch {
    return resolve(p)
  }
}

/** Files and folders that hold credentials. Never zipped, and never accepted as extra content. */
export const secretPatterns = [
  '.git',
  '.ssh',
  '.gnupg',
  '.aws',
  '.azure',
  '.docker',
  '.kube',
  '.env',
  '.env.*',
  'server.cfg',
  '.git-credentials',
  '.npmrc',
  '.netrc',
  '.pgpass',
  '.pypirc',
  '.htpasswd',
  'id_rsa*',
  'id_ed25519*',
  'id_ecdsa*',
  '*.pem',
  '*.key',
  '*.pfx',
  '*.p12',
  '*.p8',
  '*.ppk',
  '*.jks',
  '*.keystore',
  '*.kdbx'
]

const isSecretName = picomatch(secretPatterns, { dot: true, nocase: true })

/**
 * .portalbundle travels with the repo, so it is not trusted: a source must sit
 * inside the script's git repo or one of the script folders from the sidebar,
 * and never in the app's own data. A root that is the home folder or holds it
 * does not count, so a dotfiles repo can not open up ~/.ssh. Otherwise a cloned
 * resource could put files like SSH keys or saved tokens into a portal upload.
 */
async function allowedRoots(dir: string): Promise<string[]> {
  const repo = await gitRoot(dir).catch(() => null)
  const home = realpath(homedir())
  return [...getConfig().roots, repo, dir]
    .filter((r): r is string => Boolean(r))
    .map(realpath)
    .filter((root) => root === realpath(dir) || !isInside(root, home))
}

/** The part of a path below its root, checked name by name against the secret list. */
function secretSegment(roots: string[], real: string): string | null {
  const root = roots.filter((r) => isInside(r, real)).sort((a, b) => b.length - a.length)[0]
  const parts = (root ? relative(root, real) : real).split(/[\\/]/).filter(Boolean)
  // Windows ignores trailing dots and spaces, so "server.cfg." opens server.cfg.
  return parts.find((p) => isSecretName(p.replace(/[. ]+$/, ''))) ?? null
}

/** The canonical path on disk (real case, long names, links followed), or null when it can not be resolved. */
function canonical(p: string): string | null {
  try {
    return realpathSync.native(p)
  } catch {
    return null
  }
}

/** Resolves .portalbundle entries to absolute paths and zip names. Sizes are filled in by the caller. */
export async function resolveBundle(dir: string): Promise<BundleItem[]> {
  const specs = readBundle(dir)
  if (specs.length === 0) return []
  const roots = await allowedRoots(dir)
  const appData = realpath(app.getPath('userData'))
  const used = new Set([basename(dir).toLowerCase()])
  return specs.map((spec) => {
    const path = resolve(dir, spec.source)
    const name = (spec.target ?? defaultName(spec.source)).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const item: BundleItem = { ...spec, path, name, dir: false, files: 0, size: 0, error: null }

    // A ':' after the drive letter is an NTFS stream like "server.cfg::$DATA".
    const real = path.indexOf(':', 2) === -1 && existsSync(path) ? canonical(path) : null
    if (!real) item.error = 'Not found'
    else {
      // Zip exactly the path that was checked.
      item.path = real
      item.dir = statSync(real).isDirectory()
      const secret = secretSegment(roots, real)
      if (isInside(appData, real) || !roots.some((root) => isInside(root, real))) item.error = 'Outside the git repo and your script folders'
      else if (secret) item.error = `${secret} can hold passwords or keys and is never zipped`
      else if (item.dir && isInside(real, realpath(dir))) item.error = 'Contains this script folder'
    }
    if (!item.error) {
      // Names must also unpack cleanly on the buyer's Windows PC: no reserved characters or trailing dots.
      if (!name || isAbsolute(name) || name.split('/').some((p) => p === '..' || p === '.' || p === '' || /[<>:"|?*\x00-\x1f]|[. ]$/.test(p)))
        item.error = 'Invalid name in the zip'
      else if (used.has(name.toLowerCase())) item.error = `"${name}" is already used in the zip`
    }
    used.add(name.toLowerCase())
    return item
  })
}

export function bundleError(items: BundleItem[]): string | null {
  const bad = items.find((i) => i.error)
  return bad ? `Extra content ${bad.source}: ${bad.error}` : null
}
