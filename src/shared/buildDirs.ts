/** Folders a build tool rewrites as a whole, relative to the script. Each one is a single changelog line. */
export const defaultBuildDirs = ['ui/build', 'ui/dist', 'ui/app', 'web/build', 'web/dist', 'web/app', 'html/build', 'html/dist', 'nui/build', 'nui/dist']

export function cleanBuildDirs(list: string[]): string[] {
  const seen = new Set<string>()
  return list
    .map((d) =>
      d
        .trim()
        .replace(/\\/g, '/')
        .replace(/^(\.?\/)+|\/+$/g, '')
    )
    .filter((d) => {
      const key = d.toLowerCase()
      if (!d || seen.has(key) || /^[a-z]:/i.test(d) || d.split('/').some((p) => p === '' || p === '.' || p === '..')) return false
      seen.add(key)
      return true
    })
}
