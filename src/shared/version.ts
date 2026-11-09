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

export function latestVersion(versions: string[]): string | null {
  return versions.reduce<string | null>((max, v) => (max === null || compareVersions(v, max) > 0 ? v : max), null)
}
