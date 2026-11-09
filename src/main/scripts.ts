import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import { basename, join } from 'path'
import type { ScriptInfo } from '../shared/types'
import { dirtyPaths, gitRoot, toRepoPath } from './git'
import { readManifestVersion } from './manifest'

const skipDirs = new Set(['node_modules', '.git', '.github', '.vscode', 'stream', 'dist', 'build'])
const maxDepth = 6
const maxGitProcesses = 8

async function findResources(dir: string, depth: number, out: string[]): Promise<void> {
  if (existsSync(join(dir, 'fxmanifest.lua'))) {
    out.push(dir)
    return
  }
  if (depth >= maxDepth) return

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  await Promise.all(
    entries
      .filter((e) => e.isDirectory() && !skipDirs.has(e.name) && !e.name.endsWith('-nonbuild'))
      .map((e) => findResources(join(dir, e.name), depth + 1, out))
  )
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export async function scanScripts(roots: string[]): Promise<ScriptInfo[]> {
  const found = await Promise.all(
    roots.map(async (root) => {
      const dirs: string[] = []
      await findResources(root, 0, dirs)
      return dirs.map((dir) => ({ root, dir }))
    })
  )
  const scripts = found.flat()
  const repoOf = await Promise.all(scripts.map((s) => gitRoot(s.dir)))
  const repos = [...new Set(repoOf.filter((r): r is string => r !== null))]
  const dirtyLists = await mapLimit(repos, maxGitProcesses, (repo) => dirtyPaths(repo).catch(() => []))
  const dirtyByRepo = new Map(repos.map((repo, i) => [repo, dirtyLists[i]]))

  const result = await Promise.all(
    scripts.map(async ({ root, dir }, i): Promise<ScriptInfo> => {
      const repo = repoOf[i]
      const scope = repo ? toRepoPath(repo, dir) : ''
      const prefix = scope ? scope + '/' : ''
      return {
        name: basename(dir),
        path: dir,
        root,
        version: await readManifestVersion(dir).catch(() => null),
        gitRoot: repo,
        dirty: repo ? dirtyByRepo.get(repo)!.some((p) => p.startsWith(prefix)) : false
      }
    })
  )

  return result.sort((a, b) => a.name.localeCompare(b.name))
}
