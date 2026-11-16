import type { PortalVersion } from './types'

const betaSuffix = /-(b|beta|rc)(\d*)$/i

export const versionFormat = /^\d+(\.\d+){1,3}(-(b|beta|rc)\d*)?$/i

export function isBetaVersion(version: string): boolean {
  return betaSuffix.test(version.trim())
}

export function splitVersion(version: string): { base: number[]; beta: number | null } {
  const m = version.trim().match(betaSuffix)
  const core = m ? version.trim().slice(0, m.index) : version.trim()
  const base = core.split('.').map((n) => parseInt(n, 10) || 0)
  while (base.length < 3) base.push(0)
  return { base, beta: m ? parseInt(m[2] || '1', 10) : null }
}

export function compareVersions(a: string, b: string): number {
  const va = splitVersion(a)
  const vb = splitVersion(b)
  for (let i = 0; i < Math.max(va.base.length, vb.base.length); i++) {
    const d = (va.base[i] ?? 0) - (vb.base[i] ?? 0)
    if (d) return d
  }
  if (va.beta === vb.beta) return 0
  if (va.beta === null) return 1
  if (vb.beta === null) return -1
  return va.beta - vb.beta
}

export type BumpKind = 'patch' | 'minor' | 'major' | 'beta'

export function bumpVersion(version: string, kind: BumpKind): string {
  const { base, beta } = splitVersion(version)
  const [major, minor, patch] = base

  if (kind === 'beta') {
    if (beta !== null) return `${base.join('.')}-b${beta + 1}`
    return `${major}.${minor}.${patch + 1}-b1`
  }

  if (beta !== null) {
    const next = kind === 'major' ? [major + 1, 0, 0] : kind === 'minor' ? [major, minor + 1, 0] : base
    return next.join('.')
  }

  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/** The version the portal website downloads: the newest active non-beta, else the newest active one. */
export function pickVersion(versions: PortalVersion[] | undefined): PortalVersion | null {
  const active = (versions ?? []).filter((v) => v.state === 'active').sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  return active.find((v) => !v.is_release_candidate) ?? active[0] ?? null
}

export function latestVersion(versions: string[]): string | null {
  return versions.reduce<string | null>((max, v) => (max === null || compareVersions(v, max) > 0 ? v : max), null)
}

/** Every version an encrypt run uploads has this changelog prefix; only those are ever replaced. */
export const encryptChangelog = 'Encrypted from '

/**
 * The version an encrypt run uploads. A version an earlier run uploaded is replaced under the same
 * number; any other version is never touched, and the next major number is added beside it.
 */
export function pickRunVersion(versions: PortalVersion[]): { version: string; replace: PortalVersion | null } | { error: string } {
  const own = versions.filter((v) => v.changelog?.startsWith(encryptChangelog)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]
  if (own) return { version: own.version, replace: own }
  if (versions.length >= 5) return { error: 'The asset already has 5 versions and none of them was uploaded by Encrypt. Delete one on the portal, then run again.' }
  return { version: bumpVersion(latestVersion(versions.map((v) => v.version)) ?? '0.0.0', 'major'), replace: null }
}
