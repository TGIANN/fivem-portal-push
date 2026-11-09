import { faClockRotateLeft } from '@fortawesome/free-solid-svg-icons'
import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import type { PushRecord } from '../../../shared/types'
import { errorMessage, formatBytes, timeAgo } from '@/lib'
import { Button } from './ui/button'
import { Row, Tag } from './ui/group'

const outcomes = {
  live: { tone: 'accent', label: 'Live' },
  failed: { tone: 'red', label: 'Failed' },
  cancelled: { tone: 'orange', label: 'Cancelled' }
} as const

export default function PushHistory({ scriptPath, scriptName }: { scriptPath: string; scriptName: string }) {
  const [records, setRecords] = useState<PushRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = (open: boolean) => {
    if (!open) return
    setRecords(null)
    setError(null)
    window.api.pushHistory(scriptPath).then(setRecords, (e) => setError(errorMessage(e)))
  }

  return (
    <Dialog.Root onOpenChange={load}>
      <Dialog.Trigger asChild>
        <Button variant="plain" size="sm" icon={faClockRotateLeft}>
          History
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          onOpenAutoFocus={(ev) => ev.preventDefault()}
          className="fixed inset-x-0 top-[10vh] z-50 mx-auto flex max-h-[80vh] w-[min(600px,calc(100vw-48px))] flex-col overflow-hidden rounded-2xl bg-group [box-shadow:0_0_0_0.5px_rgba(255,255,255,0.1),0_24px_64px_rgba(0,0,0,0.6)] focus:outline-none"
        >
          <header className="flex items-center gap-3 border-b border-separator/60 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-headline font-semibold">Push history</Dialog.Title>
              <Dialog.Description className="truncate text-footnote text-label-2">{scriptName}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="prominent">Done</Button>
            </Dialog.Close>
          </header>
          <div className="min-h-0 overflow-y-auto">
            {error && <p className="px-5 py-4 text-footnote text-red">{error}</p>}
            {records?.length === 0 && <p className="px-5 py-4 text-footnote text-label-2">No pushes from this PC yet.</p>}
            {records?.map((r) => (
              <Row key={r.at} className="items-start px-5">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-mono tabular-nums">{r.version}</span>
                    <Tag tone={outcomes[r.outcome].tone}>{outcomes[r.outcome].label}</Tag>
                    {r.replaced && <Tag>Replaced</Tag>}
                  </span>
                  <span className="mt-0.5 block text-caption text-label-2 tabular-nums">
                    {r.files > 0 && `${r.files} files, ${formatBytes(r.size)}, `}
                    {r.seconds} s
                  </span>
                  {r.message && <span className="mt-0.5 block text-caption break-words text-label-2 selectable">{r.message}</span>}
                </span>
                <span className="shrink-0 text-footnote text-label-2 tabular-nums" title={new Date(r.at).toLocaleString()}>
                  {timeAgo(r.at)}
                </span>
              </Row>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
