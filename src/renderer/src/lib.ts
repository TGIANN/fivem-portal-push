import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const twMerge = extendTailwindMerge({
  extend: { theme: { text: ['caption', 'footnote', 'body', 'headline', 'title'] } }
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
}

export function isAuthError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { auth?: boolean }).auth === true
}

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/** "3d ago" for the last month, a short date before that. */
export function shortDate(iso: string): string {
  if (Date.now() - Date.parse(iso) < 30 * 86400000) return timeAgo(iso)
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
