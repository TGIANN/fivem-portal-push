import { faTrashCan } from '@fortawesome/free-regular-svg-icons'
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { PortalAssetDetail } from '../../../shared/types'
import { timeAgo } from '@/lib'
import { Row, Tag } from './ui/group'
import { Tooltip } from './ui/tooltip'

interface Props {
  detail: PortalAssetDetail | null
  loading: boolean
  error: string | null
  onRetry: () => void
  /** The version number this push replaces, if any. */
  replacing: string | null
  onReplace: (version: string) => void
  disabled: boolean
}

export default function PortalVersions({ detail, loading, error, onRetry, replacing, onReplace, disabled }: Props) {
  if (error) {
    return (
      <Row>
        <FontAwesomeIcon icon={faTriangleExclamation} className="text-footnote text-red" />
        <span className="min-w-0 flex-1 text-footnote text-red selectable">{error}</span>
        <button onClick={onRetry} className="cursor-pointer text-footnote font-medium text-accent hover:underline">
          Try again
        </button>
      </Row>
    )
  }

  if (loading && !detail) {
    return Array.from({ length: 3 }, (_, i) => (
      <Row key={i}>
        <span className="h-3.5 w-24 animate-pulse rounded bg-fill" />
        <span className="ml-auto h-3 w-14 animate-pulse rounded bg-fill" />
      </Row>
    ))
  }

  if (!detail) return null

  const versions = [...(detail.versions ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  if (versions.length === 0) {
    return (
      <Row>
        <span className="text-footnote text-label-2">No versions on the portal yet</span>
      </Row>
    )
  }

  const full = versions.length >= 5
  const oldestId = versions[versions.length - 1].id

  return versions.map((v) => {
    // Replacing frees its own slot, so the oldest version stays.
    const willDelete = replacing ? v.version === replacing : full && v.id === oldestId
    const canReplace = v.version !== replacing && !disabled
    return (
      <Row key={v.id} className="group">
        <Tooltip content={<span className="whitespace-pre-wrap">{v.changelog || 'No changelog'}</span>}>
          <span className={willDelete ? 'font-mono text-label-3 line-through tabular-nums' : 'font-mono tabular-nums'}>{v.version}</span>
        </Tooltip>
        {v.is_release_candidate && <Tag tone="accent">Beta</Tag>}
        {v.state !== 'active' && <Tag tone="orange">{v.state}</Tag>}
        {willDelete && (
          <span className="flex items-center gap-1.5 text-caption text-orange">
            <FontAwesomeIcon icon={faTrashCan} />
            {replacing ? 'Replaced on this push' : 'Removed on next push'}
          </span>
        )}
        {canReplace && (
          <button
            onClick={() => onReplace(v.version)}
            aria-label={`Replace ${v.version}`}
            className="ml-auto cursor-pointer text-footnote font-medium text-accent opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:underline focus-visible:opacity-100"
          >
            Replace
          </button>
        )}
        <span className={`${canReplace ? '' : 'ml-auto '}text-footnote text-label-2 tabular-nums`} title={new Date(v.created_at).toLocaleString()}>
          {timeAgo(v.created_at)}
        </span>
      </Row>
    )
  })
}
