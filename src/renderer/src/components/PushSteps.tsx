import { faCheck, faCircleNotch, faMinus, faXmark } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { AnimatePresence, motion } from 'motion/react'
import type { PushProgress, PushStepId, PushStepStatus } from '../../../shared/types'
import { cn } from '@/lib'
import { Row } from './ui/group'

const pushSteps: { id: PushStepId; label: string }[] = [
  { id: 'manifest', label: 'Update fxmanifest version' },
  { id: 'zip', label: 'Zip resource' },
  { id: 'versions', label: 'Free a version slot' },
  { id: 'upload', label: 'Upload to portal' },
  { id: 'process', label: 'Wait for portal processing' },
  { id: 'update', label: 'Post the update' },
  { id: 'git', label: 'Commit and push to GitHub' }
]

const icons: Partial<Record<PushStepStatus, typeof faCheck>> = { done: faCheck, error: faXmark, running: faCircleNotch, skipped: faMinus }

type StepState = Pick<PushProgress, 'status' | 'message' | 'progress'>

export default function PushSteps<T extends string = PushStepId>({ state, steps = pushSteps as { id: T; label: string }[] }: { state: Partial<Record<T, StepState>>; steps?: { id: T; label: string }[] }) {
  return steps.map(({ id, label }) => {
    const s = state[id]
    const status = s?.status ?? 'pending'
    const icon = icons[status]
    return (
      <Row key={id} className="items-start">
        <span
          className={cn(
            'mt-px grid size-5 shrink-0 place-items-center rounded-full text-[10px]',
            status === 'done' && 'bg-accent text-on-accent',
            status === 'error' && 'bg-red text-white',
            status === 'running' && 'text-accent',
            (status === 'pending' || status === 'skipped') && 'bg-fill text-label-3'
          )}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {icon && (
              <motion.span
                key={status}
                initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
                transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
                className="grid place-items-center"
              >
                <FontAwesomeIcon icon={icon} spin={status === 'running'} className={status === 'running' ? 'text-footnote' : ''} />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <div className="min-w-0 flex-1">
          <div className={status === 'pending' || status === 'skipped' ? 'text-label-2' : 'text-label'}>{label}</div>
          {s?.message && <div className={cn('text-footnote break-words selectable', status === 'error' ? 'text-red' : 'text-label-2')}>{s.message}</div>}
          {status === 'running' && s?.progress !== undefined && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-fill" role="progressbar" aria-valuenow={Math.round(s.progress * 100)}>
              <div className="h-full origin-left bg-accent transition-transform duration-300" style={{ transform: `scaleX(${s.progress})` }} />
            </div>
          )}
        </div>
      </Row>
    )
  })
}
