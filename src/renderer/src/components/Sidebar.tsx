import { faCircleArrowUp, faCircleXmark, faMagnifyingGlass, faRotate } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef, useState } from 'react'
import useLocalStorageState from 'use-local-storage-state'
import type { AppConfig, AppUpdateState, ScriptInfo } from '../../../shared/types'
import { compareVersions } from '../../../shared/version'
import { cn } from '@/lib'
import FoldersButton from './FoldersButton'
import Logo from './Logo'
import SettingsButton from './SettingsButton'
import SortButton, { type SortKey } from './SortButton'
import { Button } from './ui/button'
import { Segmented } from './ui/segmented'
import { Tooltip } from './ui/tooltip'

interface Props {
  config: AppConfig | null
  scripts: ScriptInfo[] | null
  scanning: boolean
  selected: string | null
  onSelect: (path: string) => void
  onRescan: () => void
  onAddRoot: () => void
  onConfig: (cfg: AppConfig) => void
  onSettings: (cfg: AppConfig) => void
  appUpdate: AppUpdateState | null
  onShowUpdate: () => void
}

type Filter = 'all' | 'changed' | 'linked'

export default function Sidebar({ config, scripts, scanning, selected, onSelect, onRescan, onAddRoot, onConfig, onSettings, appUpdate, onShowUpdate }: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useLocalStorageState<SortKey>('sidebar-sort', { defaultValue: 'name' })
  const [changedFirst, setChangedFirst] = useLocalStorageState('sidebar-changed-first', { defaultValue: true })
  const scrollRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pushedAt = (s: ScriptInfo) => (config?.lastPush[s.name] ? Date.parse(config.lastPush[s.name].at) : 0)
    const byKey = (a: ScriptInfo, b: ScriptInfo): number => {
      if (sort === 'lastPush') return pushedAt(b) - pushedAt(a)
      if (sort === 'version') {
        if (!a.version || !b.version) return a.version ? -1 : b.version ? 1 : 0
        return compareVersions(b.version, a.version)
      }
      return 0
    }
    return (scripts ?? [])
      .filter(
        (s) =>
          (!q || s.name.toLowerCase().includes(q)) &&
          (filter === 'all' || (filter === 'changed' ? s.dirty : Boolean(config?.mappings[s.name])))
      )
      .sort((a, b) => (changedFirst ? Number(b.dirty) - Number(a.dirty) : 0) || byKey(a, b) || a.name.localeCompare(b.name))
  }, [scripts, query, filter, config, sort, changedFirst])

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    getItemKey: (i) => filtered[i].path,
    paddingStart: 4,
    paddingEnd: 8
  })

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-separator/60 bg-group">
      <div className="flex h-[52px] shrink-0 items-center justify-between gap-2 pr-2 pl-4">
        <span className="flex min-w-0 items-center gap-2">
          <Logo size={22} />
          <span className="truncate text-body font-semibold">FiveM Portal Push</span>
        </span>
        <div className="flex shrink-0 items-center [&>button]:size-7">
          <Tooltip content="Rescan folders">
            <Button variant="plain" size="icon" icon={faRotate} aria-label="Rescan folders" onClick={onRescan} className={scanning ? '[&_svg]:animate-spin' : ''} />
          </Tooltip>
          <SortButton sort={sort} changedFirst={changedFirst} onSort={setSort} onChangedFirst={setChangedFirst} />
          <FoldersButton roots={config?.roots ?? []} onAdd={onAddRoot} onConfig={onConfig} />
          <SettingsButton config={config} onConfig={onSettings} appUpdate={appUpdate} onShowUpdate={onShowUpdate} />
        </div>
      </div>

      <div className="flex flex-col gap-2.5 px-3 pb-3">
        <label className="flex h-8 items-center gap-2 rounded-[9px] bg-fill px-2.5 text-label-2 focus-within:[box-shadow:0_0_0_2px_rgba(54,255,159,0.5)]">
          <FontAwesomeIcon icon={faMagnifyingGlass} className="text-caption" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search scripts"
            className="min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-label-3"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className="cursor-pointer text-label-3 hover:text-label-2">
              <FontAwesomeIcon icon={faCircleXmark} />
            </button>
          )}
        </label>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'changed', label: 'Changed' },
            { value: 'linked', label: 'Linked' }
          ]}
        />
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 [scrollbar-gutter:stable]">
        {scripts === null ? (
          Array.from({ length: 8 }, (_, i) => <div key={i} className="mx-1 my-1 h-10 animate-pulse rounded-lg bg-fill/60" />)
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <p className="text-footnote text-label-2">
              {query ? `No scripts match "${query}"` : filter !== 'all' ? 'Nothing here with this filter' : 'No scripts in these folders yet'}
            </p>
            {(query || filter !== 'all') && (
              <Button
                variant="plain"
                size="sm"
                onClick={() => {
                  setQuery('')
                  setFilter('all')
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const s = filtered[item.index]
              const mapped = config?.mappings[s.name]
              const active = selected === s.path
              return (
                <button
                  key={item.key}
                  onClick={() => onSelect(s.path)}
                  className={cn(
                    'absolute inset-x-0 flex h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-left transition-colors duration-150',
                    active ? 'bg-fill-strong' : 'hover:bg-fill/60'
                  )}
                  style={{ transform: `translateY(${Math.round(item.start)}px)` }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate leading-[1.3] font-medium">{s.name}</span>
                    <span className="block truncate text-caption text-label-2">{mapped ? mapped.assetName : 'Not linked yet'}</span>
                  </span>
                  {s.dirty && (
                    <Tooltip content="Has uncommitted changes">
                      <span className="size-1.5 shrink-0 rounded-full bg-orange" aria-label="Has uncommitted changes" />
                    </Tooltip>
                  )}
                  <span className="shrink-0 font-mono text-caption text-label-2 tabular-nums">{s.version ?? 'none'}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {(appUpdate?.status === 'available' || appUpdate?.status === 'downloading' || appUpdate?.status === 'ready') && (
        <button
          onClick={onShowUpdate}
          className="m-2 flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg bg-[rgba(54,255,159,0.14)] px-3 text-footnote font-medium text-accent transition-colors duration-150 hover:bg-[rgba(54,255,159,0.22)]"
        >
          <FontAwesomeIcon icon={faCircleArrowUp} />
          {appUpdate.status === 'ready' ? 'Restart to update' : appUpdate.status === 'downloading' ? `Downloading ${appUpdate.percent}%` : `Update to ${appUpdate.version}`}
        </button>
      )}
    </aside>
  )
}
