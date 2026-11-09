import { faRotate, faShieldHalved, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useState } from 'react'
import type { ScriptChecks, SecretFinding } from '../../../shared/types'
import { errorMessage } from '@/lib'
import { Button } from './ui/button'
import { Group, Row, Tag } from './ui/group'

interface Props {
  checks: ScriptChecks | null
  error: string | null
  busy: boolean
  onRescan: () => void
  onAllow: (id: string, allowed: boolean) => Promise<void>
  onExclude: (file: string) => Promise<void>
}

export default function ChecksSection({ checks, error, busy, onRescan, onAllow, onExclude }: Props) {
  const [actionError, setActionError] = useState<string | null>(null)
  const act = async (fn: () => Promise<void>) => {
    setActionError(null)
    try {
      await fn()
    } catch (e) {
      setActionError(errorMessage(e))
    }
  }

  const blocking = checks?.secrets.filter((s) => s.sure && !s.allowed).length ?? 0
  const clean = checks && checks.secrets.length === 0 && checks.manifest.length === 0
  const footer =
    (actionError ?? error) ? (
      <span className="text-red">{actionError ?? error}</span>
    ) : blocking > 0 ? (
      <span className="text-red">Push is blocked while {blocking === 1 ? 'this key is' : 'these keys are'} in the zip. Remove it from the file, exclude the file, or allow it if it is meant for buyers.</span>
    ) : checks ? (
      `${checks.scanned} text files checked for keys, tokens and webhooks, and fxmanifest.lua compared with the zip. Values are hidden here and never written to the log.`
    ) : (
      'Checking the files that go into the zip'
    )

  const secretRow = (s: SecretFinding) => (
    <Row key={s.id}>
      <FontAwesomeIcon icon={faShieldHalved} className={`text-footnote ${s.allowed ? 'text-label-3' : s.sure ? 'text-red' : 'text-orange'}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-footnote selectable" title={s.file}>
          {s.file}:{s.line}
        </span>
        <span className="block truncate font-mono text-caption text-label-2">{s.preview}</span>
      </span>
      <Tag tone={s.allowed ? 'neutral' : s.sure ? 'red' : 'orange'}>{s.allowed ? `${s.kind}, allowed` : s.kind}</Tag>
      {s.own && (
        <Button variant="plain" size="sm" onClick={() => act(() => onExclude(s.file))}>
          Exclude
        </Button>
      )}
      <Button variant="plain" size="sm" onClick={() => act(() => onAllow(s.id, !s.allowed))}>
        {s.allowed ? 'Undo' : 'Allow'}
      </Button>
    </Row>
  )

  return (
    <Group
      header="Before upload"
      aside={
        <Button variant="plain" size="sm" icon={faRotate} busy={busy} onClick={onRescan}>
          Check again
        </Button>
      }
      footer={footer}
    >
      {!checks && !error && (
        <Row>
          <span className="h-3.5 w-48 animate-pulse rounded bg-fill" />
        </Row>
      )}
      {clean && (
        <Row>
          <span className="text-footnote text-label-2">No keys, tokens or webhooks found, and every file in fxmanifest.lua is in the zip.</span>
        </Row>
      )}
      {checks && !clean && (
        <div className="max-h-80 overflow-y-auto">
          {checks.secrets.map(secretRow)}
          {checks.manifest.map((m) => (
            <Row key={`${m.directive}:${m.entry}`}>
              <FontAwesomeIcon icon={faTriangleExclamation} className="text-footnote text-orange" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-footnote selectable">{m.entry}</span>
                <span className="block text-caption text-label-2">{m.problem}</span>
              </span>
              <Tag>{m.directive}</Tag>
            </Row>
          ))}
        </div>
      )}
    </Group>
  )
}
