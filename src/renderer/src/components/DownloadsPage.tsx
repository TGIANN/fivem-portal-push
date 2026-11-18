import { faCheck, faCircleNotch, faCircleXmark, faDownload, faFolderOpen, faForward, faMagnifyingGlass, faRotate, faTriangleExclamation, faXmark } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import useLocalStorageState from 'use-local-storage-state'
import type { AppConfig, AuthState, DownloadConflict, DownloadEntity, Downloadable } from '../../../shared/types'
import { useDownloadProgress } from '@/hooks'
import { cn, errorMessage, shortDate } from '@/lib'
import ConflictDialog from './ConflictDialog'
import LoginNotice from './LoginNotice'
import { percent } from './PortalVersions'
import Toolbar from './Toolbar'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Group, Row, Tag } from './ui/group'
import { Segmented } from './ui/segmented'
import { Switch } from './ui/switch'
import { Tooltip } from './ui/tooltip'

interface Props {
  config: AppConfig
  auth: AuthState
  account: ReactNode
  waiting: boolean
  onLogin: () => void
  onAuthError: (e: unknown) => void
  onConfig: (cfg: AppConfig) => void
}

type Sort = 'name' | 'updated' | 'received'

const time = (iso: string | null): number => (iso ? Date.parse(iso) : 0)

function DateCell({ iso }: { iso: string | null }) {
  return (
    <span className="w-24 shrink-0 text-right text-footnote text-label-2 tabular-nums" title={iso ? new Date(iso).toLocaleString() : undefined}>
      {iso ? shortDate(iso) : '—'}
    </span>
  )
}

export default function DownloadsPage({ config, auth, account, waiting, onLogin, onAuthError, onConfig }: Props) {
  const [tab, setTab] = useLocalStorageState<DownloadEntity>('downloads-tab', { defaultValue: 'asset-grants' })
  const [sort, setSort] = useLocalStorageState<Sort>('downloads-sort', { defaultValue: 'updated' })
  const [lists, setLists] = useState<Partial<Record<DownloadEntity, Downloadable[]>>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [running, setRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [conflicts, setConflicts] = useState<DownloadConflict[] | null>(null)
  const { progress, reset } = useDownloadProgress()
  const granted = tab === 'asset-grants'

  useEffect(() => window.api.onDownloadConflicts(setConflicts), [])
  const sortBy: Sort = !granted && sort === 'received' ? 'updated' : sort

  const load = useCallback(
    async (entity: DownloadEntity) => {
      setLoading(true)
      setError(null)
      try {
        const list = await window.api.listDownloadables(entity)
        setLists((l) => ({ ...l, [entity]: list }))
      } catch (e) {
        setError(errorMessage(e))
        onAuthError(e)
      } finally {
        setLoading(false)
      }
    },
    [onAuthError]
  )

  useEffect(() => {
    if (auth === 'loggedIn' && !lists[tab]) load(tab)
  }, [auth, tab, lists, load])

  const items = lists[tab] ?? null
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (items ?? [])
      .filter((i) => !q || i.name.toLowerCase().includes(q) || i.author?.toLowerCase().includes(q))
      .sort((a, b) =>
        sortBy === 'updated' ? time(b.updatedAt) - time(a.updatedAt) : sortBy === 'received' ? time(b.receivedAt) - time(a.receivedAt) : a.name.localeCompare(b.name)
      )
  }, [items, query, sortBy])
  const selectable = visible.filter((i) => !i.unavailable)
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.key))
  const updated = selectable.filter((i) => i.updated)

  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const setMany = (list: Downloadable[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s)
      for (const i of list) {
        if (on) next.add(i.key)
        else next.delete(i.key)
      }
      return next
    })

  const canStart = auth === 'loggedIn' && selected.size > 0 && Boolean(config.downloadDir) && !running

  const start = async () => {
    if (!canStart) return
    setRunning(true)
    setResult(null)
    reset()
    try {
      const { done, failed, skipped } = await window.api.startDownloads([...selected])
      const text = [`${done} downloaded`, skipped && `${skipped} skipped`, failed && `${failed} failed`].filter(Boolean).join(', ')
      setResult(failed ? { ok: false, text: `${text}. Hover the red mark for the reason.` } : { ok: true, text: `${text}.` })
      setSelected(new Set())
    } catch (e) {
      setResult({ ok: false, text: errorMessage(e) })
      onAuthError(e)
    } finally {
      setRunning(false)
      setCancelling(false)
      // Downloading clears the "updated" mark of granted assets.
      if (lists['asset-grants']) load('asset-grants')
    }
  }

  return (
    <>
      <Toolbar trailing={account} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-6 px-8 pt-6 pb-16">
          <div>
            <h1 className="text-title font-bold tracking-[0.01em]">Download assets</h1>
            <p className="mt-1 text-footnote text-label-2">Pick any number of assets from your Cfx.re account and download the newest version of each in one go.</p>
          </div>

          {auth !== 'loggedIn' ? (
            <LoginNotice auth={auth} waiting={waiting} what="The asset lists come from your portal account." onLogin={onLogin} />
          ) : (
            <div className="flex items-start gap-6">
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-72 shrink-0">
                    <Segmented<DownloadEntity>
                      value={tab}
                      onChange={(t) => {
                        setTab(t)
                        setQuery('')
                      }}
                      options={[
                        { value: 'asset-grants', label: `Granted to me${lists['asset-grants'] ? ` · ${lists['asset-grants'].length}` : ''}` },
                        { value: 'assets', label: `Created by me${lists.assets ? ` · ${lists.assets.length}` : ''}` }
                      ]}
                    />
                  </div>
                  <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[9px] bg-fill px-2.5 text-label-2 focus-within:[box-shadow:0_0_0_2px_rgba(54,255,159,0.5)]">
                    <FontAwesomeIcon icon={faMagnifyingGlass} className="text-caption" />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or creator" className="min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-label-3" />
                    {query && (
                      <button onClick={() => setQuery('')} aria-label="Clear search" className="cursor-pointer text-label-3 hover:text-label-2">
                        <FontAwesomeIcon icon={faCircleXmark} />
                      </button>
                    )}
                  </label>
                </div>

                <div className="flex items-center gap-1">
                  <span className="mr-1 text-footnote text-label-2">Sort</span>
                  {(
                    [
                      ['updated', 'Last updated'],
                      ['received', 'Date received'],
                      ['name', 'Name']
                    ] as const
                  )
                    .filter(([key]) => granted || key !== 'received')
                    .map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setSort(key)}
                        className={cn(
                          'h-7 cursor-pointer rounded-full px-3 text-footnote transition-colors duration-150',
                          sortBy === key ? 'bg-fill-strong font-medium text-label' : 'text-label-2 hover:bg-fill hover:text-label'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  <span className="ml-auto flex items-center gap-1">
                    {granted && updated.length > 0 && (
                      <Button variant="plain" size="sm" disabled={running} onClick={() => setMany(updated, true)}>
                        Select updated ({updated.length})
                      </Button>
                    )}
                    <Button variant="plain" size="sm" disabled={running || selectable.length === 0} onClick={() => setMany(selectable, !allSelected)}>
                      {allSelected ? 'Select none' : 'Select all'}
                    </Button>
                    <Tooltip content="Reload the list">
                      <Button variant="plain" size="icon" icon={faRotate} aria-label="Reload the list" disabled={running} onClick={() => load(tab)} className={cn('size-7', loading && '[&_svg]:animate-spin')} />
                    </Tooltip>
                  </span>
                </div>

                <Group>
                  <div className="flex h-9 items-center gap-3 border-b border-separator px-4 text-caption text-label-2">
                    <span className="w-[18px] shrink-0" />
                    <span className="flex-1">Asset</span>
                    <span className="w-16 shrink-0 text-right">Version</span>
                    <span className="w-24 shrink-0 text-right">Updated</span>
                    {granted && <span className="w-24 shrink-0 text-right">Received</span>}
                    <span className="w-14 shrink-0" />
                  </div>
                  {error ? (
                    <Row>
                      <span className="min-w-0 flex-1 text-footnote text-red selectable">{error}</span>
                      <button onClick={() => load(tab)} className="cursor-pointer text-footnote font-medium text-accent hover:underline">
                        Try again
                      </button>
                    </Row>
                  ) : !items ? (
                    Array.from({ length: 8 }, (_, i) => (
                      <Row key={i}>
                        <span className="size-[18px] animate-pulse rounded-[5px] bg-fill" />
                        <span className="h-3.5 w-48 animate-pulse rounded bg-fill" />
                      </Row>
                    ))
                  ) : visible.length === 0 ? (
                    <Row>
                      <span className="text-footnote text-label-2">{query ? `No assets match "${query}"` : 'No assets here yet'}</span>
                    </Row>
                  ) : (
                    visible.map((i) => {
                      const p = progress[i.key]
                      const version = i.version ?? p?.version ?? null
                      return (
                        <Row key={i.key} className={i.unavailable ? 'opacity-60' : undefined}>
                          <Checkbox checked={selected.has(i.key)} disabled={Boolean(i.unavailable) || running} onChange={() => toggle(i.key)} label={`Select ${i.name}`} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate font-medium">{i.name}</span>
                              {i.updated && <Tag tone="accent">Updated</Tag>}
                            </span>
                            <span className="block truncate text-caption text-label-2">{i.unavailable ?? i.author ?? ' '}</span>
                          </span>
                          <span className="w-16 shrink-0 truncate text-right font-mono text-footnote text-label-2 tabular-nums" title={version || !granted ? undefined : 'Shown once it is downloaded'}>
                            {version ?? '—'}
                          </span>
                          <DateCell iso={i.updatedAt} />
                          {granted && <DateCell iso={i.receivedAt} />}
                          <span className="flex w-14 shrink-0 justify-end text-footnote">
                            {p?.status === 'running' ? (
                              <span className="text-label-2 tabular-nums">{p.message === 'Unpacking' ? <FontAwesomeIcon icon={faCircleNotch} spin /> : percent(p.progress) || <FontAwesomeIcon icon={faCircleNotch} spin />}</span>
                            ) : p?.status === 'done' ? (
                              <Tooltip content={p.message ?? 'Done'}>
                                <span className="grid size-5 place-items-center rounded-full bg-accent text-[10px] text-on-accent" aria-label={p.message ?? 'Done'}>
                                  <FontAwesomeIcon icon={faCheck} />
                                </span>
                              </Tooltip>
                            ) : p?.status === 'skipped' ? (
                              <Tooltip content={p.message ?? 'Skipped'}>
                                <span className="text-label-2" aria-label={p.message ?? 'Skipped'}>
                                  <FontAwesomeIcon icon={faForward} />
                                </span>
                              </Tooltip>
                            ) : p?.status === 'error' ? (
                              <Tooltip content={p.message ?? 'Failed'}>
                                <span className="text-red" aria-label={p.message ?? 'Failed'}>
                                  <FontAwesomeIcon icon={faTriangleExclamation} />
                                </span>
                              </Tooltip>
                            ) : null}
                          </span>
                        </Row>
                      )
                    })
                  )}
                </Group>
              </div>

              <aside className="sticky top-0 flex w-[272px] shrink-0 flex-col gap-4">
                <Group header="Save to">
                  <Row>
                    <button
                      onClick={async () => onConfig(await window.api.pickDownloadDir())}
                      disabled={running}
                      title={config.downloadDir ?? undefined}
                      className="min-w-0 flex-1 cursor-pointer truncate text-left text-footnote disabled:cursor-not-allowed"
                    >
                      {config.downloadDir ?? <span className="text-accent">Choose a folder</span>}
                    </button>
                    {config.downloadDir && (
                      <Tooltip content="Open in Explorer">
                        <Button variant="plain" size="icon" icon={faFolderOpen} aria-label="Open download folder" onClick={() => window.api.openDownloadDir()} className="-mr-2 size-7" />
                      </Tooltip>
                    )}
                  </Row>
                  <Row>
                    <span className="text-footnote">Unzip into folders</span>
                    <span className="ml-auto">
                      <Switch checked={config.downloadExtract} disabled={running} onCheckedChange={async (on) => onConfig(await window.api.setDownloadExtract(on))} label="Unzip into folders" />
                    </span>
                  </Row>
                </Group>
                <p className="-mt-2.5 px-4 text-caption text-label-2">
                  {config.downloadExtract
                    ? 'Each zip is unpacked here and then deleted. When a folder is already there, you get one list at the end to pick what to replace and what to skip.'
                    : 'Saved as <name>-<version>.zip. A zip that is already there is kept, and the new one gets a (2) name.'}
                </p>

                <div className="flex flex-col gap-2.5 rounded-[10px] bg-group p-4">
                  <span className="text-headline font-semibold tabular-nums">{selected.size ? `${selected.size} selected` : 'Nothing selected'}</span>
                  <span className="text-caption text-label-2">Each one downloads its newest version, one after another.</span>
                  <Button variant="prominent" icon={faDownload} busy={running} disabled={!canStart} onClick={start} className="mt-1 justify-center">
                    {running ? 'Downloading' : 'Download'}
                  </Button>
                  {running && (
                    <Button
                      variant="plain"
                      icon={faXmark}
                      busy={cancelling}
                      onClick={() => {
                        setCancelling(true)
                        window.api.cancelDownloads()
                      }}
                      className="justify-center"
                    >
                      {cancelling ? 'Cancelling' : 'Cancel'}
                    </Button>
                  )}
                  {!config.downloadDir && <span className="text-caption text-orange">Choose a folder to save to first.</span>}
                  {result && <span className={cn('text-caption', result.ok ? 'text-accent' : 'text-red')}>{result.text}</span>}
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
      {conflicts && (
        <ConflictDialog
          conflicts={conflicts}
          onDone={(choices) => {
            setConflicts(null)
            window.api.resolveConflicts(choices)
          }}
        />
      )}
    </>
  )
}
