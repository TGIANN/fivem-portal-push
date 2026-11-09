import { faFolderPlus } from '@fortawesome/free-solid-svg-icons'
import { faFolderOpen } from '@fortawesome/free-regular-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppConfig, AuthState, ScriptInfo } from '../../shared/types'
import AccountButton, { type LoginMethod } from './components/AccountButton'
import AppUpdateDialog from './components/AppUpdateDialog'
import ScriptPanel from './components/ScriptPanel'
import Sidebar from './components/Sidebar'
import Toolbar from './components/Toolbar'
import { Button } from './components/ui/button'
import { TooltipProvider } from './components/ui/tooltip'
import { useAppUpdate } from './hooks'
import { errorMessage, isAuthError } from './lib'

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [scripts, setScripts] = useState<ScriptInfo[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [auth, setAuth] = useState<AuthState>('checking')
  const [authError, setAuthError] = useState<string | null>(null)
  const [waiting, setWaiting] = useState<LoginMethod | null>(null)
  const appUpdate = useAppUpdate()
  const [updateOpen, setUpdateOpen] = useState(false)
  const announced = useRef<string | null>(null)

  // Each new version opens the update screen once; after "Later" it waits in the sidebar.
  useEffect(() => {
    if (appUpdate?.status !== 'available' || appUpdate.version === announced.current) return
    announced.current = appUpdate.version
    setUpdateOpen(true)
  }, [appUpdate])

  const rescan = useCallback(async () => {
    setScanning(true)
    try {
      setScripts(await window.api.scanScripts())
    } finally {
      setScanning(false)
    }
  }, [])

  const reloadConfig = useCallback(async () => setConfig(await window.api.getConfig()), [])

  const onAuthError = useCallback((e: unknown) => {
    if (isAuthError(e)) setAuth('loggedOut')
  }, [])

  useEffect(() => {
    reloadConfig().then(rescan)
    window.api
      .checkAuth()
      .then((r) => setAuth(r.ok ? 'loggedIn' : 'loggedOut'))
      .catch((e) => {
        setAuth('loggedOut')
        setAuthError(errorMessage(e))
      })
    return window.api.onOpenScript(async (path) => {
      await reloadConfig()
      await rescan()
      setSelected(path)
    })
  }, [reloadConfig, rescan])

  const login = async (method: LoginMethod) => {
    setWaiting(method)
    setAuthError(null)
    try {
      const done = method === 'browser' ? await window.api.browserLogin() : await window.api.login()
      const check = done ? await window.api.checkAuth() : null
      setAuth(check?.ok ? 'loggedIn' : 'loggedOut')
      if (!check) setAuthError('The login was not finished. Try again.')
      else if (!check.ok) setAuthError(check.reason ?? 'The portal did not accept the session.')
    } catch (e) {
      setAuth('loggedOut')
      setAuthError(errorMessage(e))
    } finally {
      setWaiting(null)
    }
  }

  const logout = async () => {
    await window.api.logout()
    setAuth('loggedOut')
  }

  const addRoot = async () => {
    setConfig(await window.api.addRoot())
    await rescan()
  }

  const script = scripts?.find((s) => s.path === selected) ?? null
  const account = (
    <AccountButton auth={auth} waiting={waiting} error={authError} onLogin={login} onCancel={() => window.api.cancelBrowserLogin()} onLogout={logout} />
  )

  return (
    <TooltipProvider>
      <div className="flex h-full">
        <Sidebar
          config={config}
          scripts={scripts}
          scanning={scanning}
          selected={selected}
          onSelect={setSelected}
          onRescan={rescan}
          onAddRoot={addRoot}
          onConfig={async (cfg) => {
            setConfig(cfg)
            await rescan()
          }}
          onSettings={setConfig}
          appUpdate={appUpdate}
          onShowUpdate={() => setUpdateOpen(true)}
        />
        {appUpdate?.version && <AppUpdateDialog state={appUpdate} open={updateOpen} onOpenChange={setUpdateOpen} />}
        <main className="flex min-w-0 flex-1 flex-col">
          {script && config ? (
            <ScriptPanel
              key={script.path}
              script={script}
              config={config}
              auth={auth}
              account={account}
              onAuthError={onAuthError}
              onPushed={async () => {
                await reloadConfig()
                await rescan()
              }}
              onConfig={setConfig}
            />
          ) : (
            <>
              <Toolbar trailing={account} />
              <div className="grid flex-1 place-items-center p-8">
                <div className="flex max-w-80 flex-col items-center gap-3 text-center">
                  <FontAwesomeIcon icon={faFolderOpen} className="text-[32px] text-label-3" />
                  {config?.roots.length ? (
                    <>
                      <p className="text-headline font-semibold">No script selected</p>
                      <p className="text-footnote text-label-2">Pick a script from the sidebar to update its version and push it to the portal.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-headline font-semibold">Add your scripts</p>
                      <p className="text-footnote text-label-2">Choose a folder that holds your resources. Every folder with an fxmanifest.lua inside shows up in the sidebar.</p>
                      <Button variant="tinted" icon={faFolderPlus} onClick={addRoot} className="mt-1">
                        Add script folder
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </TooltipProvider>
  )
}
