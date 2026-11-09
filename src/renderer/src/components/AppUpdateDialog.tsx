import { faArrowRight, faDownload, faRotateRight, faUpRightFromSquare } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import type { AppUpdateState } from '../../../shared/types'
import { errorMessage } from '@/lib'
import { Button } from './ui/button'

interface Props {
  state: AppUpdateState
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function AppUpdateDialog({ state, open, onOpenChange }: Props) {
  const [installError, setInstallError] = useState<string | null>(null)
  const downloading = state.status === 'downloading'
  const ready = state.status === 'ready'
  const error = installError ?? state.error

  const install = async () => {
    setInstallError(null)
    try {
      await window.api.installAppUpdate()
    } catch (e) {
      setInstallError(errorMessage(e))
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          onOpenAutoFocus={(ev) => ev.preventDefault()}
          className="fixed inset-x-0 top-[14vh] z-50 mx-auto flex max-h-[72vh] w-[min(520px,calc(100vw-48px))] flex-col overflow-hidden rounded-2xl bg-group [box-shadow:0_0_0_0.5px_rgba(255,255,255,0.1),0_24px_64px_rgba(0,0,0,0.6)] focus:outline-none"
        >
          <header className="border-b border-separator/60 px-5 py-3.5">
            <Dialog.Title className="text-headline font-semibold">{ready ? 'Ready to install' : 'A new version is available'}</Dialog.Title>
            <Dialog.Description className="mt-0.5 flex items-center gap-2 font-mono text-footnote text-label-2 tabular-nums">
              {state.current}
              <FontAwesomeIcon icon={faArrowRight} className="text-caption text-label-3" />
              <span className="text-accent">{state.version}</span>
            </Dialog.Description>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <p className="text-footnote leading-[1.55] whitespace-pre-wrap text-label selectable">{state.notes || 'No release notes for this version.'}</p>
          </div>

          {(downloading || ready) && (
            <div className="h-1 bg-fill" role="progressbar" aria-valuenow={state.percent}>
              <div className="h-full origin-left bg-accent transition-transform duration-300" style={{ transform: `scaleX(${state.percent / 100})` }} />
            </div>
          )}

          <footer className="flex items-center justify-end gap-2 border-t border-separator/60 px-5 py-3">
            {error && <p className="mr-auto min-w-0 text-footnote break-words text-red">{error}</p>}
            {!error && state.portable && <p className="mr-auto text-footnote text-label-2">The portable version is replaced by hand.</p>}
            <Dialog.Close asChild>
              <Button variant="plain">Later</Button>
            </Dialog.Close>
            {ready ? (
              <Button variant="prominent" icon={faRotateRight} onClick={install}>
                Restart and install
              </Button>
            ) : (
              <Button variant="prominent" icon={state.portable ? faUpRightFromSquare : faDownload} busy={downloading} onClick={() => window.api.downloadAppUpdate()}>
                {downloading ? `Downloading ${state.percent}%` : state.portable ? 'Open download page' : 'Download update'}
              </Button>
            )}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
