import { faGear } from '@fortawesome/free-solid-svg-icons'
import * as Dialog from '@radix-ui/react-dialog'
import { useState, type ReactNode } from 'react'
import { updateApiDocsUrl } from '../../../shared/links'
import type { AppConfig, DiscordMode, SecretName, UpdateSettings, UpdateTarget } from '../../../shared/types'
import { cn, errorMessage } from '@/lib'
import { Button } from './ui/button'
import { Group, Row } from './ui/group'
import { Segmented } from './ui/segmented'
import { Switch } from './ui/switch'
import { Tooltip } from './ui/tooltip'

const inputClass =
  'h-8 min-w-0 flex-1 rounded-md bg-fill px-2.5 font-mono text-footnote outline-none placeholder:font-sans placeholder:text-label-3 focus:[box-shadow:0_0_0_2px_rgba(54,255,159,0.5)]'

function Label({ children }: { children: ReactNode }) {
  return <span className="w-28 shrink-0 text-body">{children}</span>
}

function TextRow({ label, value, placeholder, onSave }: { label: string; value: string; placeholder: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null && draft.trim() !== value) onSave(draft.trim())
    setDraft(null)
  }
  return (
    <Row>
      <Label>{label}</Label>
      <input
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        placeholder={placeholder}
        spellCheck={false}
        className={inputClass}
      />
    </Row>
  )
}

function SecretRow({ label, saved, placeholder, onSave }: { label: string; saved: boolean; placeholder: string; onSave: (v: string | null) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const close = () => {
    setEditing(false)
    setDraft('')
  }
  const commit = async () => {
    if (draft.trim()) await onSave(draft.trim())
    close()
  }

  if (saved && !editing) {
    return (
      <Row>
        <Label>{label}</Label>
        <span className="flex-1 font-mono text-footnote text-label-2">••••••••••••</span>
        <Button variant="plain" size="sm" onClick={() => setEditing(true)}>
          Replace
        </Button>
        <Button variant="plain" size="sm" className="hover:text-red" onClick={() => onSave(null)}>
          Remove
        </Button>
      </Row>
    )
  }
  return (
    <Row>
      <Label>{label}</Label>
      <input
        type="password"
        value={draft}
        autoFocus={editing}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            e.stopPropagation()
            close()
          }
        }}
        placeholder={placeholder}
        spellCheck={false}
        className={inputClass}
      />
    </Row>
  )
}

function TestRow({ target, ready }: { target: UpdateTarget; ready: boolean }) {
  const [state, setState] = useState<{ busy: boolean; ok?: boolean; text?: string }>({ busy: false })
  const run = async () => {
    setState({ busy: true })
    try {
      setState({ busy: false, ok: true, text: await window.api.checkUpdateTarget(target) })
    } catch (e) {
      setState({ busy: false, ok: false, text: errorMessage(e) })
    }
  }
  return (
    <Row>
      <Button variant="tinted" size="sm" busy={state.busy} disabled={!ready} onClick={run}>
        Test connection
      </Button>
      {state.text && <span className={cn('min-w-0 flex-1 text-footnote break-words', state.ok ? 'text-accent' : 'text-red')}>{state.text}</span>}
    </Row>
  )
}

export default function SettingsButton({ config, onConfig }: { config: AppConfig | null; onConfig: (cfg: AppConfig) => void }) {
  const [error, setError] = useState<string | null>(null)
  const update = config?.update
  const secrets = config?.secrets

  const run = async (fn: () => Promise<AppConfig>) => {
    setError(null)
    try {
      onConfig(await fn())
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  const setUpdate = (patch: Partial<UpdateSettings>) => run(() => window.api.setUpdateSettings(patch))
  const setSecret = (name: SecretName) => (value: string | null) => run(() => window.api.setSecret(name, value))

  const discordReady = update?.discordMode === 'bot' ? Boolean(secrets?.botToken && update.discordChannel) : Boolean(secrets?.webhookUrl)

  return (
    <Dialog.Root onOpenChange={() => setError(null)}>
      <Tooltip content="Settings">
        <Dialog.Trigger asChild>
          <Button variant="plain" size="icon" icon={faGear} aria-label="Settings" />
        </Dialog.Trigger>
      </Tooltip>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          onOpenAutoFocus={(ev) => ev.preventDefault()}
          className="fixed inset-x-0 top-[6vh] z-50 mx-auto flex max-h-[88vh] w-[min(600px,calc(100vw-48px))] flex-col overflow-hidden rounded-2xl bg-group [box-shadow:0_0_0_0.5px_rgba(255,255,255,0.1),0_24px_64px_rgba(0,0,0,0.6)] focus:outline-none"
        >
          <header className="flex items-center gap-3 border-b border-separator/60 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-headline font-semibold">Settings</Dialog.Title>
              <Dialog.Description className="truncate text-footnote text-label-2">Defaults and connections used for every script.</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="prominent">Done</Button>
            </Dialog.Close>
          </header>

          {config && update && secrets && (
            <div className="flex min-h-0 flex-col gap-7 overflow-y-auto px-5 pt-5 pb-6">
              {error && <p className="rounded-[10px] bg-red/15 px-4 py-2.5 text-footnote text-red">{error}</p>}

              <Group header="GitHub" boxClassName="bg-elevated" footer="The starting state of the GitHub switch on every script. Changing it also resets the choice saved for single scripts.">
                <Row>
                  <span className="text-body">Commit and push after upload</span>
                  <span className="ml-auto">
                    <Switch checked={config.gitDefault} onCheckedChange={(value) => run(() => window.api.setGitDefault(value))} label="Commit and push after upload by default" />
                  </span>
                </Row>
              </Group>

              <Group header="Update post" boxClassName="bg-elevated" footer="The starting state of the update switches on every script. Each one needs its connection below. @here and @everyone can be picked as the tag only while they are allowed here, for the app's own Discord post and for the site's.">
                <Row>
                  <span className="text-body">Post to the update API</span>
                  <span className="ml-auto">
                    <Switch checked={update.apiDefault} onCheckedChange={(v) => setUpdate({ apiDefault: v })} label="Post to the update API by default" />
                  </span>
                </Row>
                <Row>
                  <span className="text-body">Post to Discord</span>
                  <span className="ml-auto">
                    <Switch checked={update.discordDefault} onCheckedChange={(v) => setUpdate({ discordDefault: v })} label="Post to Discord by default" />
                  </span>
                </Row>
                <Row>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body">Allow @here</span>
                    <span className="block text-caption text-label-2">Pings every online member of the server</span>
                  </span>
                  <Switch checked={update.allowHere} onCheckedChange={(v) => setUpdate({ allowHere: v })} label="Allow @here" />
                </Row>
                <Row>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body">Allow @everyone</span>
                    <span className="block text-caption text-label-2">Pings every member of the server</span>
                  </span>
                  <Switch checked={update.allowEveryone} onCheckedChange={(v) => setUpdate({ allowEveryone: v })} label="Allow @everyone" />
                </Row>
              </Group>

              <Group
                header="Update API"
                boxClassName="bg-elevated"
                footer={
                  <>
                    Your own site's endpoint. The key is sent as a Bearer token and stored encrypted on this PC. What your API receives and must answer is in the{' '}
                    <a href={updateApiDocsUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      Update API docs
                    </a>
                    .
                  </>
                }
              >
                <TextRow label="URL" value={update.apiUrl} placeholder="https://example.com/api/updates" onSave={(v) => setUpdate({ apiUrl: v })} />
                <SecretRow label="Key" saved={secrets.apiKey} placeholder="Paste the API key" onSave={setSecret('apiKey')} />
                <Row>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body">Site posts the Discord announcement</span>
                    <span className="block text-caption text-label-2">Roles come from the site, and the app's own Discord post is skipped</span>
                  </span>
                  <Switch checked={update.apiAnnounces} onCheckedChange={(v) => setUpdate({ apiAnnounces: v })} label="Site posts the Discord announcement" />
                </Row>
                <TestRow target="api" ready={Boolean(update.apiUrl && secrets.apiKey)} />
              </Group>

              <Group
                header="Discord"
                boxClassName="bg-elevated"
                footer={
                  update.discordMode === 'bot'
                    ? 'The bot needs to see the channel and send messages there. It also lists the server roles you can tag.'
                    : 'A webhook only posts. To tag a role, paste its ID on the script, or use a bot to pick from the role list.'
                }
              >
                <Row>
                  <Label>Send with</Label>
                  <div className="flex-1">
                    <Segmented<DiscordMode>
                      value={update.discordMode}
                      onChange={(v) => setUpdate({ discordMode: v })}
                      options={[
                        { value: 'webhook', label: 'Webhook' },
                        { value: 'bot', label: 'Bot' }
                      ]}
                    />
                  </div>
                </Row>
                {update.discordMode === 'webhook' ? (
                  <SecretRow label="Webhook URL" saved={secrets.webhookUrl} placeholder="https://discord.com/api/webhooks/..." onSave={setSecret('webhookUrl')} />
                ) : (
                  <>
                    <SecretRow label="Bot token" saved={secrets.botToken} placeholder="Paste the bot token" onSave={setSecret('botToken')} />
                    <TextRow label="Channel ID" value={update.discordChannel} placeholder="Right click the channel, Copy Channel ID" onSave={(v) => setUpdate({ discordChannel: v })} />
                  </>
                )}
                <TestRow key={update.discordMode} target="discord" ready={discordReady} />
              </Group>

              <Group header="Tebex" boxClassName="bg-elevated" footer="The public token from your Tebex panel, Integrations, Headless API. It is used to pick the package name for updates.">
                <TextRow label="Public key" value={update.tebexToken} placeholder="Tebex public token" onSave={(v) => setUpdate({ tebexToken: v })} />
                <TestRow target="tebex" ready={Boolean(update.tebexToken)} />
              </Group>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
