import { faTrashCan } from '@fortawesome/free-regular-svg-icons'
import { faArrowRight, faFolderOpen, faLock, faPlay, faPlus, faXmark } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useEffect, useState, type ReactNode } from 'react'
import type { AppConfig, AuthState, EncryptJob, EncryptProgress, EncryptStepId } from '../../../shared/types'
import { pickRunVersion } from '../../../shared/version'
import { cn, errorMessage, timeAgo } from '@/lib'
import AssetPicker from './AssetPicker'
import LoginNotice from './LoginNotice'
import PushSteps from './PushSteps'
import Toolbar from './Toolbar'
import { Button } from './ui/button'
import { Group, Row } from './ui/group'
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

const encryptSteps: { id: EncryptStepId; label: string }[] = [
  { id: 'scan', label: 'Check for keys and webhooks' },
  { id: 'zip', label: 'Zip the folder' },
  { id: 'versions', label: 'Pick the portal version' },
  { id: 'upload', label: 'Upload to portal' },
  { id: 'process', label: 'Wait for the portal to encrypt' },
  { id: 'download', label: 'Download the encrypted zip' },
  { id: 'extract', label: 'Replace the target folder' }
]

const howItWorks: { title: string; text: string }[] = [
  { title: 'Zip', text: 'The folder is zipped with your zip rules, the way you would do it by hand.' },
  { title: 'Upload', text: 'It goes to the asset as one version. Escrow reuses the version it uploaded last time and never touches the others.' },
  { title: 'Encrypt', text: 'The portal encrypts every script in it. A big folder can take a while.' },
  { title: 'Replace', text: 'The encrypted zip is downloaded and the target folder is replaced with it.' }
]

type Steps = Partial<Record<EncryptStepId, EncryptProgress>>

export default function EncryptPage({ config, auth, account, waiting, onLogin, onAuthError, onConfig }: Props) {
  const [running, setRunning] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [steps, setSteps] = useState<Record<string, Steps>>({})
  const [errors, setErrors] = useState<Record<string, string | null>>({})

  useEffect(() => window.api.onEncryptProgress((p) => setSteps((s) => ({ ...s, [p.jobId]: { ...s[p.jobId], [p.step]: p } }))), [])

  const act = async (id: string, fn: () => Promise<AppConfig>) => {
    setErrors((e) => ({ ...e, [id]: null }))
    try {
      onConfig(await fn())
    } catch (e) {
      setErrors((x) => ({ ...x, [id]: errorMessage(e) }))
      onAuthError(e)
    }
  }

  // The steps and the last run line show how a run ended, so its error is not shown a third time.
  const run = async (job: EncryptJob) => {
    setRunning(job.id)
    setErrors((e) => ({ ...e, [job.id]: null }))
    setSteps((s) => ({ ...s, [job.id]: {} }))
    try {
      await window.api.runEncryptJob(job.id)
    } catch (e) {
      onAuthError(e)
    } finally {
      onConfig(await window.api.getConfig())
      setRunning(null)
      setCancelling(false)
    }
  }

  return (
    <>
      <Toolbar trailing={account} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-6 px-8 pt-6 pb-16">
          <div>
            <h1 className="text-title font-bold tracking-[0.01em]">Server escrow</h1>
            <p className="mt-1 text-footnote text-label-2">
              Encrypt your server's own scripts with Cfx.re Asset Escrow: the open scripts go in, the encrypted copies your server runs come out. Run it again after every change.
            </p>
          </div>

          {auth !== 'loggedIn' ? (
            <LoginNotice auth={auth} waiting={waiting} what="Escrow uploads to an asset on your portal account." onLogin={onLogin} />
          ) : (
            <div className="flex items-start gap-6">
              <div className="flex min-w-0 flex-1 flex-col gap-6">
                {config.encryptJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    steps={steps[job.id]}
                    error={errors[job.id] ?? null}
                    running={running}
                    cancelling={cancelling}
                    onRun={() => run(job)}
                    onCancel={() => {
                      setCancelling(true)
                      window.api.cancelEncryptJob()
                    }}
                    onAct={(fn) => act(job.id, fn)}
                    onAuthError={onAuthError}
                  />
                ))}

                {config.encryptJobs.length === 0 && (
                  <div className="flex flex-col items-center gap-3 rounded-2xl bg-group px-8 py-12 text-center">
                    <span className="grid size-14 place-items-center rounded-full bg-fill text-[22px] text-label-2">
                      <FontAwesomeIcon icon={faLock} />
                    </span>
                    <p className="text-headline font-semibold">No folder pairs yet</p>
                    <p className="max-w-96 text-footnote text-label-2">
                      A pair is the folder with your open scripts, for example <span className="font-mono">[our-need-cfx]</span>, and the folder the server loads the encrypted ones from, for example{' '}
                      <span className="font-mono">[our-cfx]</span>.
                    </p>
                  </div>
                )}

                <Button variant="tinted" icon={faPlus} className="self-start" disabled={Boolean(running)} onClick={async () => onConfig(await window.api.addEncryptJob())}>
                  Add folder pair
                </Button>
              </div>

              <aside className="sticky top-0 flex w-[272px] shrink-0 flex-col gap-4 rounded-[10px] bg-group p-4">
                <span className="text-headline font-semibold">How it works</span>
                <ol className="flex flex-col gap-3.5">
                  {howItWorks.map((s, i) => (
                    <li key={s.title} className="flex gap-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-fill text-caption font-semibold text-label-2 tabular-nums">{i + 1}</span>
                      <span className="min-w-0">
                        <span className="block text-footnote font-medium">{s.title}</span>
                        <span className="block text-caption text-label-2">{s.text}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="border-t border-separator pt-3.5 text-caption text-label-2">
                  Use an asset that holds only these scripts, with one placeholder version such as 1.0.0. Stop the server first if it locks files in the target folder.
                </p>
              </aside>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

interface CardProps {
  job: EncryptJob
  steps: Steps | undefined
  error: string | null
  /** The job that is running, if any. */
  running: string | null
  cancelling: boolean
  onRun: () => void
  onCancel: () => void
  onAct: (fn: () => Promise<AppConfig>) => Promise<void>
  onAuthError: (e: unknown) => void
}

/** What the next run will do with the asset's versions, worked out the same way the run does it. */
function useVersionPlan(assetId: number | null, refresh: string | undefined): string | null {
  const [plan, setPlan] = useState<string | null>(null)
  useEffect(() => {
    setPlan(null)
    if (!assetId) return
    let live = true
    window.api
      .assetDetail(assetId)
      .then((detail) => {
        if (!live) return
        const p = pickRunVersion(detail.versions ?? [])
        setPlan('error' in p ? p.error : p.replace ? `Replaces ${p.version}` : `Adds ${p.version}`)
      })
      .catch((e) => live && setPlan(`Could not read the asset: ${errorMessage(e)}`))
    return () => {
      live = false
    }
  }, [assetId, refresh])
  return plan
}

function JobCard({ job, steps, error, running, cancelling, onRun, onCancel, onAct, onAuthError }: CardProps) {
  const isRunning = running === job.id
  const ready = Boolean(job.source && job.target && job.assetId)
  const plan = useVersionPlan(job.assetId, job.lastRun?.at)
  const name = (path: string) => path.split(/[\\/]/).pop()

  const folderRow = (which: 'source' | 'target', label: string) => (
    <Row>
      <span className="w-44 shrink-0 text-body">{label}</span>
      <button
        onClick={() => onAct(() => window.api.pickEncryptFolder(job.id, which))}
        disabled={Boolean(running)}
        className="min-w-0 flex-1 cursor-pointer truncate text-right text-footnote text-label-2 hover:text-label disabled:cursor-not-allowed"
        title={job[which] || undefined}
      >
        {job[which] || <span className="text-accent">Choose a folder</span>}
      </button>
      {job[which] && (
        <Tooltip content="Open in Explorer">
          <Button variant="plain" size="icon" icon={faFolderOpen} aria-label={`Open ${label}`} onClick={() => window.api.openEncryptFolder(job.id, which)} className="-mr-2 size-7" />
        </Tooltip>
      )}
    </Row>
  )

  return (
    <Group
      header={
        job.source || job.target ? (
          <span className="flex items-center gap-2">
            {job.source ? name(job.source) : '…'}
            <FontAwesomeIcon icon={faArrowRight} className="text-[10px] text-label-3" />
            {job.target ? name(job.target) : '…'}
          </span>
        ) : (
          'New folder pair'
        )
      }
      aside={
        <div className="flex items-center gap-1">
          {!isRunning && (
            <Tooltip content="Remove this folder pair">
              <Button variant="plain" size="icon" icon={faTrashCan} aria-label="Remove this folder pair" disabled={Boolean(running)} onClick={() => onAct(() => window.api.removeEncryptJob(job.id))} className="size-7" />
            </Tooltip>
          )}
          {isRunning ? (
            <Button variant="plain" size="sm" icon={faXmark} busy={cancelling} disabled={steps?.extract?.status === 'running'} onClick={onCancel}>
              {cancelling ? 'Cancelling' : 'Cancel'}
            </Button>
          ) : (
            <Button variant="tinted" size="sm" icon={faPlay} disabled={!ready || Boolean(running)} onClick={onRun}>
              Encrypt
            </Button>
          )}
        </div>
      }
      footer={
        <>
          Replaces <b className="font-medium text-label">everything</b> in the target folder with the encrypted scripts. Zip rules apply: <span className="font-mono">.portalignore</span> in the source folder and the rules for
          all scripts.
        </>
      }
    >
      {folderRow('source', 'Open scripts')}
      {folderRow('target', 'Encrypted scripts go to')}
      <AssetPicker
        value={job.assetId && job.assetName ? { assetId: job.assetId, assetName: job.assetName } : null}
        autoMatched={false}
        disabled={Boolean(running)}
        onChange={(a) => onAct(() => window.api.updateEncryptJob(job.id, { assetId: a.assetId, assetName: a.assetName }))}
        onError={onAuthError}
      />
      {job.assetId && (
        <Row>
          <span className="text-body">Portal version</span>
          <span className={cn('ml-auto text-footnote tabular-nums', plan && !/^(Adds|Replaces) /.test(plan) ? 'text-orange' : 'text-label-2')}>{plan ?? 'Reading the asset'}</span>
        </Row>
      )}
      {steps && <PushSteps<EncryptStepId> state={steps} steps={encryptSteps} />}
      {error && (
        <Row>
          <span className="text-footnote text-red selectable">{error}</span>
        </Row>
      )}
      {job.lastRun && !isRunning && (
        <Row>
          <span className={cn('min-w-0 flex-1 text-footnote', job.lastRun.ok ? 'text-label-2' : 'text-red')}>
            Last run {timeAgo(job.lastRun.at)}: {job.lastRun.message}
          </span>
        </Row>
      )}
    </Group>
  )
}
