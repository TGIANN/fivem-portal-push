import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'path'
import type { ChangedFile } from '../shared/types'

// Windows looks in the working folder before PATH, so a plain "git" would start
// a git.exe that ships inside a resource. Only an absolute path from PATH is used.
function findGit(): string | null {
  const exe = process.platform === 'win32' ? 'git.exe' : 'git'
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    const dir = entry.trim().replace(/^"|"$/g, '')
    if (isAbsolute(dir) && existsSync(join(dir, exe))) return join(dir, exe)
  }
  return null
}

const gitPath = findGit()

export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!gitPath) return reject(new Error('Git was not found on this PC.'))
    execFile(gitPath, ['-c', 'core.fsmonitor=false', ...args], { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()))
      else resolve(stdout)
    })
  })
}

/**
 * The app reads every repo it finds on its own, also ones the user never trusted,
 * and a resource can ship a .git folder whose config or hooks name programs to run.
 * Status and diff must not start them, so hooks and the repo's own filters are off.
 */
async function readOnlyArgs(root: string): Promise<string[]> {
  const keys = await git(root, ['config', '--includes', '--local', '--name-only', '--get-regexp', '^filter\\.']).catch(() => '')
  const filters = keys
    .split('\n')
    .filter(Boolean)
    .flatMap((key) => ['-c', key.endsWith('.required') ? `${key}=false` : `${key}=`])
  return ['--no-optional-locks', '-c', 'core.hooksPath=/dev/null', ...filters]
}

export async function gitRoot(dir: string): Promise<string | null> {
  let current = resolve(dir)
  for (;;) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export function toRepoPath(root: string, dir: string): string {
  return relative(root, dir).replace(/\\/g, '/')
}

export async function dirtyPaths(root: string): Promise<string[]> {
  const out = await git(root, [...(await readOnlyArgs(root)), 'status', '--porcelain', '-z', '--untracked-files=all', '--ignore-submodules=all'])
  const entries = out.split('\0')
  const paths: string[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (entry.length < 4) continue
    paths.push(entry.slice(3))
    if (entry[0] === 'R' || entry[0] === 'C') i++
  }
  return paths
}

export async function headCommit(root: string): Promise<string | null> {
  try {
    return (await git(root, ['rev-parse', 'HEAD'])).trim()
  } catch {
    return null
  }
}

const statusMap: Record<string, ChangedFile['status']> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed' }

export async function changedFiles(root: string, dir: string, since: string | null): Promise<ChangedFile[]> {
  const scope = toRepoPath(root, dir)
  // git refuses an empty path, which is what a script at the top of its repo has.
  const pathspec = scope || '.'
  const files = new Map<string, ChangedFile['status']>()
  const safe = await readOnlyArgs(root)

  if (since) {
    const out = await git(root, [...safe, 'diff', '--name-status', '-z', '--no-renames', '--no-ext-diff', '--ignore-submodules=all', since, '--', pathspec])
    const parts = out.split('\0').filter(Boolean)
    for (let i = 0; i + 1 < parts.length; i += 2) {
      files.set(parts[i + 1], statusMap[parts[i][0]] ?? 'modified')
    }
  } else {
    const out = await git(root, [...safe, 'status', '--porcelain', '-z', '--untracked-files=all', '--ignore-submodules=all', '--', pathspec])
    for (const entry of out.split('\0')) {
      if (entry.length < 4) continue
      const code = entry.slice(0, 2)
      const status = code === '??' || code.includes('A') ? 'added' : code.includes('D') ? 'deleted' : 'modified'
      files.set(entry.slice(3), status)
    }
  }

  const untracked = await git(root, [...safe, 'ls-files', '--others', '--exclude-standard', '-z', '--', pathspec])
  for (const file of untracked.split('\0').filter(Boolean)) files.set(file, 'added')

  const prefix = scope ? scope + '/' : ''
  const changes = [...files].map(([file, status]) => ({ status, file: file.startsWith(prefix) ? file.slice(prefix.length) : file }))
  return collapseDirs(dir, changes)
}

async function listFiles(dir: string, rel = '', out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(join(dir, rel), { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const path = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) await listFiles(dir, path, out)
    else out.push(path)
  }
  return out
}

function ancestors(file: string): string[] {
  const parts = file.split('/')
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}

async function collapseDirs(dir: string, changes: ChangedFile[]): Promise<ChangedFile[]> {
  const diskCount = new Map<string, number>()
  const addedCount = new Map<string, number>()
  for (const file of await listFiles(dir)) for (const d of ancestors(file)) diskCount.set(d, (diskCount.get(d) ?? 0) + 1)
  for (const c of changes) if (c.status === 'added') for (const d of ancestors(c.file)) addedCount.set(d, (addedCount.get(d) ?? 0) + 1)

  const out = new Map<string, ChangedFile>()
  for (const c of changes) {
    const d = ancestors(c.file).find((a) =>
      c.status === 'added' ? addedCount.get(a) === diskCount.get(a) : c.status === 'deleted' && !diskCount.has(a)
    )
    const file = d ? d + '/' : c.file
    out.set(`${c.status}:${file}`, { status: c.status, file })
  }
  return [...out.values()]
}

export async function commitAndPush(root: string, dir: string, message: string, log: (msg: string) => void): Promise<string | null> {
  const scope = toRepoPath(root, dir) || '.'
  await git(root, ['add', '-A', '--', scope])

  const staged = await git(root, ['diff', '--cached', '--name-only', '--', scope])
  if (staged.trim()) {
    await git(root, ['commit', '-m', message, '--only', '--', scope])
    log('Committed')
  } else {
    log('Nothing to commit, pushing existing commits')
  }

  await git(root, ['push'])
  return headCommit(root)
}
