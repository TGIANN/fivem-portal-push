import { faArrowUpFromBracket, faCircleArrowUp, faDownload, faGear, faLock } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { forwardRef, type ComponentProps } from 'react'
import type { AppConfig, AppUpdateState } from '../../../shared/types'
import { cn } from '@/lib'
import SettingsButton from './SettingsButton'
import { Tooltip } from './ui/tooltip'

export type Page = 'script' | 'encrypt' | 'downloads'

const pages: { page: Page; label: string; hint: string; icon: typeof faLock }[] = [
  { page: 'script', label: 'Push', hint: 'Upload one script as a new portal version', icon: faArrowUpFromBracket },
  { page: 'encrypt', label: 'Escrow', hint: "Encrypt your server's own scripts with Cfx.re Asset Escrow", icon: faLock },
  { page: 'downloads', label: 'Download', hint: 'Download many assets from your account at once', icon: faDownload }
]

const RailButton = forwardRef<HTMLButtonElement, ComponentProps<'button'> & { icon: typeof faLock; label: string; active?: boolean; tone?: 'accent' }>(
  function RailButton({ icon, label, active, tone, className, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          'flex w-[72px] cursor-pointer flex-col items-center gap-1.5 rounded-xl px-1 pt-2.5 pb-2 text-[11px] leading-none font-medium transition-colors duration-150',
          active ? 'bg-fill-strong text-label' : tone === 'accent' ? 'text-accent hover:bg-[rgba(54,255,159,0.14)]' : 'text-label-2 hover:bg-fill/60 hover:text-label',
          className
        )}
        {...props}
      >
        <FontAwesomeIcon icon={icon} className={cn('text-[18px]', active && 'text-accent')} />
        {label}
      </button>
    )
  }
)

interface Props {
  page: Page
  onPage: (page: Page) => void
  config: AppConfig | null
  onConfig: (cfg: AppConfig) => void
  appUpdate: AppUpdateState | null
  onShowUpdate: () => void
}

export default function NavRail({ page, onPage, config, onConfig, appUpdate, onShowUpdate }: Props) {
  const update = appUpdate?.status === 'available' || appUpdate?.status === 'downloading' || appUpdate?.status === 'ready'
  return (
    <nav className="flex w-[88px] shrink-0 flex-col items-center gap-1.5 border-r border-separator/60 py-3">
      {pages.map((p) => (
        <Tooltip key={p.page} content={p.hint}>
          <RailButton icon={p.icon} label={p.label} active={page === p.page} aria-current={page === p.page ? 'page' : undefined} onClick={() => onPage(p.page)} />
        </Tooltip>
      ))}
      <div className="mt-auto flex flex-col items-center gap-1.5">
        {update && (
          <RailButton
            icon={faCircleArrowUp}
            tone="accent"
            label={appUpdate.status === 'ready' ? 'Restart' : appUpdate.status === 'downloading' ? `${appUpdate.percent}%` : 'Update'}
            onClick={onShowUpdate}
          />
        )}
        <SettingsButton config={config} onConfig={onConfig} appUpdate={appUpdate} onShowUpdate={onShowUpdate} trigger={<RailButton icon={faGear} label="Settings" aria-label="Settings" />} />
      </div>
    </nav>
  )
}
