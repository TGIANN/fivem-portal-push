import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import type { ConflictChoice, DownloadConflict } from '../../../shared/types'
import { Button } from './ui/button'
import { Row, Tag } from './ui/group'
import { Segmented } from './ui/segmented'

interface Props {
  conflicts: DownloadConflict[]
  /** Closing the dialog any other way than Apply answers with nothing, which skips every name. */
  onDone: (choices: Record<string, ConflictChoice>) => void
}

const all = (conflicts: DownloadConflict[], pick: (c: DownloadConflict) => ConflictChoice): Record<string, ConflictChoice> => Object.fromEntries(conflicts.map((c) => [c.id, pick(c)]))

/** One list for every folder name a download batch found taken, instead of asking one by one. */
export default function ConflictDialog({ conflicts, onDone }: Props) {
  // A folder the same asset unpacked before is an update, so it starts on Replace; anything else starts on Skip.
  const [choices, setChoices] = useState(() => all(conflicts, (c) => (c.sameAsset ? 'replace' : 'skip')))
  const replacing = conflicts.filter((c) => choices[c.id] === 'replace').length
  const skipping = conflicts.length - replacing

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onDone({})}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          onOpenAutoFocus={(ev) => ev.preventDefault()}
          // A stray click beside the list must not skip everything; Escape and the button still do.
          onPointerDownOutside={(ev) => ev.preventDefault()}
          className="fixed inset-x-0 top-[10vh] z-50 mx-auto flex max-h-[80vh] w-[min(640px,calc(100vw-48px))] flex-col overflow-hidden rounded-2xl bg-group [box-shadow:0_0_0_0.5px_rgba(255,255,255,0.1),0_24px_64px_rgba(0,0,0,0.6)] focus:outline-none"
        >
          <header className="border-b border-separator/60 px-5 py-3.5">
            <Dialog.Title className="text-headline font-semibold">
              {conflicts.length === 1 ? 'This folder is already there' : `${conflicts.length} folders are already there`}
            </Dialog.Title>
            <Dialog.Description className="mt-0.5 text-footnote text-label-2">
              Replace deletes the folder in your download folder and puts the new one in its place. Skip keeps yours and drops the new one.
            </Dialog.Description>
          </header>

          <div className="flex items-center gap-1 border-b border-separator/60 px-5 py-2">
            <span className="mr-auto text-footnote text-label-2">For all</span>
            <Button variant="plain" size="sm" onClick={() => setChoices(all(conflicts, () => 'skip'))}>
              Skip all
            </Button>
            <Button variant="plain" size="sm" onClick={() => setChoices(all(conflicts, () => 'replace'))}>
              Replace all
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {conflicts.map((c) => (
              <Row key={c.id}>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-mono text-footnote font-medium selectable">{c.name}</span>
                    {c.sameAsset && <Tag tone="accent">Earlier download</Tag>}
                  </span>
                  <span className="block truncate text-caption text-label-2">
                    From {c.asset}
                    {c.existing !== c.name && ` · there as ${c.existing}`}
                  </span>
                </span>
                <div className="w-44 shrink-0">
                  <Segmented<ConflictChoice>
                    value={choices[c.id]}
                    onChange={(v) => setChoices((s) => ({ ...s, [c.id]: v }))}
                    options={[
                      { value: 'skip', label: 'Skip' },
                      { value: 'replace', label: 'Replace' }
                    ]}
                  />
                </div>
              </Row>
            ))}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-separator/60 px-5 py-3">
            <p className="mr-auto text-footnote text-label-2 tabular-nums">
              {[replacing && `${replacing} to replace`, skipping && `${skipping} to skip`].filter(Boolean).join(', ')}
            </p>
            <Dialog.Close asChild>
              <Button variant="plain">Skip all and close</Button>
            </Dialog.Close>
            <Button variant={replacing ? 'destructive' : 'prominent'} onClick={() => onDone(choices)}>
              {replacing ? `Replace ${replacing}` : 'Continue'}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
