import { faCheck, faChevronDown, faCircleNotch, faImage, faMagnifyingGlass, faXmark } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import * as Popover from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import { useEffect, useState, type ReactNode } from 'react'
import type { AppConfig, DiscordRole, TebexPackage, UpdateImage } from '../../../shared/types'
import { cn, errorMessage, formatBytes, normalizeName } from '@/lib'
import { Button } from './ui/button'
import { Group, Row, Tag } from './ui/group'
import { Switch } from './ui/switch'
import { Tooltip } from './ui/tooltip'

export interface UpdateDraft {
  api: boolean | null
  discord: boolean | null
  package: TebexPackage | null
  autoMatched: boolean
  roleId: string | null
  notes: string
  images: UpdateImage[]
}

export const maxImages = 10

export function newUpdateDraft(config: AppConfig, script: string): UpdateDraft {
  return { api: null, discord: null, package: config.packages[script] ?? null, autoMatched: false, roleId: config.update.roleId, notes: '', images: [] }
}

export function updateTargets(config: AppConfig, draft: UpdateDraft) {
  const { update, secrets } = config
  const apiReady = Boolean(update.apiUrl && secrets.apiKey)
  const discordReady = update.discordMode === 'bot' ? Boolean(secrets.botToken && update.discordChannel) : secrets.webhookUrl
  return {
    apiReady,
    discordReady,
    api: apiReady && (draft.api ?? update.apiDefault),
    discord: discordReady && (draft.discord ?? update.discordDefault)
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

const popoverClass = 'z-50 w-[380px] rounded-xl bg-elevated p-1.5 [box-shadow:0_0_0_0.5px_rgba(255,255,255,0.1),0_12px_32px_rgba(0,0,0,0.55)]'
const triggerClass =
  'flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-fill/50 disabled:cursor-not-allowed disabled:hover:bg-transparent'

function useRemote<T>(load: (refresh: boolean) => Promise<T>, enabled: boolean) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    load(attempt > 0)
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [load, enabled, attempt])
  return { data, error, retry: () => setAttempt((n) => n + 1) }
}

function PickerList<T>({
  items,
  error,
  onRetry,
  placeholder,
  empty,
  render,
  keyOf,
  search,
  onPick,
  selected,
  extra
}: {
  items: T[] | null
  error: string | null
  onRetry: () => void
  placeholder: string
  empty: string
  render: (item: T) => ReactNode
  keyOf: (item: T) => string
  search: (item: T) => string
  onPick: (item: T) => void
  selected: string | null
  extra?: ReactNode
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filtered = (items ?? []).filter((i) => !q || search(i).toLowerCase().includes(q))
  return (
    <Command shouldFilter={false} loop>
      <label className="mb-1 flex h-8 items-center gap-2 rounded-md bg-fill px-2.5 text-label-2">
        <FontAwesomeIcon icon={faMagnifyingGlass} className="text-caption" />
        <Command.Input value={query} onValueChange={setQuery} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-label-3" />
        {!items && !error && <FontAwesomeIcon icon={faCircleNotch} spin className="text-caption" />}
      </label>
      <Command.List className="max-h-72 overflow-y-auto">
        {error ? (
          <div className="flex flex-col items-start gap-2 p-2.5">
            <p className="text-footnote text-red">{error}</p>
            <button onClick={onRetry} className="cursor-pointer text-footnote font-medium text-accent hover:underline">
              Try again
            </button>
          </div>
        ) : items === null ? (
          Array.from({ length: 5 }, (_, i) => <div key={i} className="my-1 h-8 animate-pulse rounded-md bg-fill/60" />)
        ) : (
          <Command.Empty className="p-2.5 text-footnote text-label-2">{empty}</Command.Empty>
        )}
        {!error && (
          <Command.Group>
            {extra}
            {filtered.map((item) => (
              <Command.Item
                key={keyOf(item)}
                value={keyOf(item)}
                onSelect={() => onPick(item)}
                className="flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2.5 data-[selected=true]:bg-fill"
              >
                <span className="w-3.5 text-caption text-accent">{selected === keyOf(item) && <FontAwesomeIcon icon={faCheck} />}</span>
                {render(item)}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command>
  )
}

type MassTag = 'here' | 'everyone'

/** The tag that can really be sent: @here / @everyone only while Settings allow them, roles only with a numeric ID. */
export function usableTag(config: AppConfig, tag: string | null): string | null {
  if (tag === 'here') return config.update.allowHere ? tag : null
  if (tag === 'everyone') return config.update.allowEveryone ? tag : null
  return tag && /^\d{5,25}$/.test(tag) ? tag : null
}

function massTags(config: AppConfig): MassTag[] {
  return (['here', 'everyone'] as const).filter((t) => (t === 'here' ? config.update.allowHere : config.update.allowEveryone))
}

const isMassTag = (tag: string | null): tag is MassTag => tag === 'here' || tag === 'everyone'

function roleColor(color: number): string {
  return color ? `#${color.toString(16).padStart(6, '0')}` : 'rgba(235,235,245,0.3)'
}

interface Props {
  scriptName: string
  assetName: string | null
  config: AppConfig
  draft: UpdateDraft
  disabled: boolean
  onDraft: (patch: Partial<UpdateDraft>) => void
}

export default function UpdateSection({ scriptName, assetName, config, draft, disabled, onDraft }: Props) {
  const [packageOpen, setPackageOpen] = useState(false)
  const [roleOpen, setRoleOpen] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const targets = updateTargets(config, draft)
  const active = targets.api || targets.discord
  const hasTebex = Boolean(config.update.tebexToken)
  const bot = config.update.discordMode === 'bot'

  const packages = useRemote(window.api.tebexPackages, active && hasTebex)
  const roles = useRemote(window.api.discordRoles, targets.discord && bot)

  // Link the Tebex package by name the first time, like the portal asset.
  useEffect(() => {
    if (draft.package || !packages.data) return
    const names = [scriptName, assetName].filter((n): n is string => Boolean(n)).map(normalizeName)
    const match = packages.data.find((p) => names.includes(normalizeName(p.name)))
    if (match) onDraft({ package: match, autoMatched: true })
  }, [packages.data, draft.package, scriptName, assetName, onDraft])

  const addImages = async () => {
    setImageError(null)
    try {
      const picked = await window.api.pickImages()
      const merged = [...draft.images, ...picked.filter((p) => !draft.images.some((i) => i.path === p.path))]
      if (merged.length > maxImages) setImageError(`Only the first ${maxImages} images are kept.`)
      onDraft({ images: merged.slice(0, maxImages) })
    } catch (e) {
      setImageError(errorMessage(e))
    }
  }

  const tag = usableTag(config, draft.roleId)
  const role = roles.data?.find((r) => r.id === tag) ?? null
  const mass = massTags(config)
  const itemClass = 'flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2.5 data-[selected=true]:bg-fill'
  const pickTag = (value: string | null) => {
    onDraft({ roleId: value })
    setRoleOpen(false)
  }
  const apiHost = hostOf(config.update.apiUrl)

  const footer = imageError ? (
    <span className="text-red">{imageError}</span>
  ) : !targets.apiReady && !targets.discordReady ? (
    'Connect your update API or Discord in Settings to post update notes with each push.'
  ) : active && targets.api && !draft.package ? (
    <span className="text-orange">Pick the package so the update lands on the right product.</span>
  ) : active ? (
    'Changed files are taken from the changelog above. Sent after the portal upload is live.'
  ) : (
    'Turn on a target to post update notes with this push.'
  )

  return (
    <Group header="Update post" footer={footer}>
      <Row>
        <span className="min-w-0 flex-1">
          <span className="block text-body">Post to {apiHost ?? 'the update API'}</span>
          {!targets.apiReady && <span className="block text-caption text-label-2">Set up the update API in Settings</span>}
        </span>
        <Switch checked={targets.api} disabled={!targets.apiReady || disabled} onCheckedChange={(v) => onDraft({ api: v })} label="Post to the update API" />
      </Row>
      <Row>
        <span className="min-w-0 flex-1">
          <span className="block text-body">Post to Discord</span>
          {!targets.discordReady && <span className="block text-caption text-label-2">Set up a webhook or bot in Settings</span>}
        </span>
        <Switch checked={targets.discord} disabled={!targets.discordReady || disabled} onCheckedChange={(v) => onDraft({ discord: v })} label="Post to Discord" />
      </Row>

      {active && (
        <>
          <Popover.Root open={packageOpen} onOpenChange={setPackageOpen}>
            <Popover.Trigger disabled={!hasTebex || disabled} className={cn(triggerClass, 'relative not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-4 not-first:before:h-px not-first:before:bg-separator')}>
              <span className="text-body">Package</span>
              <span className="ml-auto flex min-w-0 items-center gap-2">
                {draft.autoMatched && draft.package && <Tag tone="accent">Matched by name</Tag>}
                <span className={draft.package ? 'truncate text-label-2' : 'text-label-3'}>
                  {draft.package ? draft.package.name : hasTebex ? 'Choose' : 'Add a Tebex key in Settings'}
                </span>
                <FontAwesomeIcon icon={faChevronDown} className="text-caption text-label-3" />
              </span>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="end" sideOffset={4} className={popoverClass}>
                <PickerList<TebexPackage>
                  items={packages.data}
                  error={packages.error}
                  onRetry={packages.retry}
                  placeholder="Search your Tebex packages"
                  empty="No packages match this search"
                  keyOf={(p) => String(p.id)}
                  search={(p) => `${p.name} ${p.id}`}
                  selected={draft.package ? String(draft.package.id) : null}
                  onPick={(p) => {
                    onDraft({ package: p, autoMatched: false })
                    setPackageOpen(false)
                  }}
                  render={(p) => (
                    <>
                      <span className="min-w-0 flex-1 truncate text-body">{p.name}</span>
                      <span className="font-mono text-caption text-label-3 tabular-nums">#{p.id}</span>
                    </>
                  )}
                />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          {targets.discord &&
            (bot ? (
              <Popover.Root open={roleOpen} onOpenChange={setRoleOpen}>
                <Popover.Trigger disabled={disabled} className={cn(triggerClass, 'relative before:absolute before:top-0 before:right-0 before:left-4 before:h-px before:bg-separator')}>
                  <span className="text-body">Tag role</span>
                  <span className="ml-auto flex min-w-0 items-center gap-2">
                    {tag && !isMassTag(tag) && <span className="size-2.5 shrink-0 rounded-full" style={{ background: roleColor(role?.color ?? 0) }} />}
                    {isMassTag(tag) && <Tag tone="orange">Mass ping</Tag>}
                    <span className={tag ? 'truncate text-label-2' : 'text-label-3'}>{tag ? (isMassTag(tag) ? `@${tag}` : role ? `@${role.name}` : tag) : 'No tag'}</span>
                    <FontAwesomeIcon icon={faChevronDown} className="text-caption text-label-3" />
                  </span>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content align="end" sideOffset={4} className={popoverClass}>
                    <PickerList<DiscordRole>
                      items={roles.data}
                      error={roles.error}
                      onRetry={roles.retry}
                      placeholder="Search server roles"
                      empty="No roles match this search"
                      keyOf={(r) => r.id}
                      search={(r) => r.name}
                      selected={tag}
                      onPick={(r) => pickTag(r.id)}
                      extra={
                        <>
                          <Command.Item value="none" onSelect={() => pickTag(null)} className={cn(itemClass, 'text-label-2')}>
                            <span className="w-3.5 text-caption text-accent">{!tag && <FontAwesomeIcon icon={faCheck} />}</span>
                            No tag
                          </Command.Item>
                          {mass.map((t) => (
                            <Command.Item key={t} value={t} onSelect={() => pickTag(t)} className={itemClass}>
                              <span className="w-3.5 text-caption text-accent">{tag === t && <FontAwesomeIcon icon={faCheck} />}</span>
                              <span className="min-w-0 flex-1 truncate text-body">@{t}</span>
                              <span className="text-caption text-label-3">{t === 'here' ? 'Online members' : 'Every member'}</span>
                            </Command.Item>
                          ))}
                        </>
                      }
                      render={(r) => (
                        <>
                          <span className="size-2.5 shrink-0 rounded-full" style={{ background: roleColor(r.color) }} />
                          <span className="min-w-0 flex-1 truncate text-body">{r.name}</span>
                        </>
                      )}
                    />
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            ) : (
              <Row>
                <span className="text-body">Tag role</span>
                <span className="ml-auto flex items-center gap-1.5">
                  {mass.map((t) => (
                    <button
                      key={t}
                      onClick={() => onDraft({ roleId: tag === t ? null : t })}
                      disabled={disabled}
                      aria-pressed={tag === t}
                      className={cn(
                        'h-8 cursor-pointer rounded-md px-2.5 font-mono text-footnote transition-colors duration-150 disabled:opacity-40',
                        tag === t ? 'bg-orange/15 text-orange' : 'bg-fill text-label-2 hover:text-label'
                      )}
                    >
                      @{t}
                    </button>
                  ))}
                  <input
                    value={isMassTag(tag) ? '' : (draft.roleId ?? '')}
                    onChange={(e) => onDraft({ roleId: e.target.value.replace(/\D/g, '') || null })}
                    placeholder="Role ID, empty for no tag"
                    disabled={disabled}
                    spellCheck={false}
                    className="h-8 w-56 rounded-md bg-fill px-2.5 font-mono text-footnote outline-none placeholder:font-sans placeholder:text-label-3 focus:[box-shadow:0_0_0_2px_rgba(54,255,159,0.5)]"
                  />
                </span>
              </Row>
            ))}

          <Row className="items-start">
            <textarea
              value={draft.notes}
              onChange={(e) => onDraft({ notes: e.target.value })}
              placeholder={'Update notes, one change per line\n- Added ...\n- Fixed ...'}
              disabled={disabled}
              rows={Math.min(14, Math.max(4, draft.notes.split('\n').length + 1))}
              className="-mx-4 -my-2.5 block w-[calc(100%+32px)] resize-none bg-transparent px-4 py-3 text-body leading-[1.55] outline-none placeholder:text-label-3"
            />
          </Row>

          <Row>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {draft.images.length === 0 && <span className="text-footnote text-label-2">No images</span>}
              {draft.images.map((img) => (
                <Tooltip key={img.path} content={`${img.name}, ${formatBytes(img.size)}`}>
                  <span className="group relative block h-14 overflow-hidden rounded-md bg-fill">
                    <img src={img.thumb} alt={img.name} className="h-full w-auto" />
                    <button
                      onClick={() => onDraft({ images: draft.images.filter((i) => i.path !== img.path) })}
                      disabled={disabled}
                      aria-label={`Remove ${img.name}`}
                      className="absolute top-1 right-1 grid size-5 cursor-pointer place-items-center rounded-full bg-black/70 text-[10px] text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <FontAwesomeIcon icon={faXmark} />
                    </button>
                  </span>
                </Tooltip>
              ))}
            </div>
            <Button variant="plain" size="sm" icon={faImage} disabled={disabled || draft.images.length >= maxImages} onClick={addImages}>
              Add images
            </Button>
          </Row>
        </>
      )}
    </Group>
  )
}
