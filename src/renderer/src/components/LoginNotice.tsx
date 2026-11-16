import { faRightToBracket } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { AuthState } from '../../../shared/types'
import { Button } from './ui/button'

/** Shown in place of a page that needs the portal while you are logged out. */
export default function LoginNotice({ auth, waiting, what, onLogin }: { auth: AuthState; waiting: boolean; what: string; onLogin: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-group px-8 py-14 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-fill text-[22px] text-label-2">
        <FontAwesomeIcon icon={faRightToBracket} />
      </span>
      <p className="text-headline font-semibold">{auth === 'checking' ? 'Checking your portal session' : 'You are not logged in'}</p>
      <p className="max-w-96 text-footnote text-label-2">{what} Log in to the Cfx.re portal with your browser to continue.</p>
      <Button variant="prominent" icon={faRightToBracket} busy={waiting || auth === 'checking'} onClick={onLogin} className="mt-2">
        {waiting ? 'Waiting for browser' : 'Log in with browser'}
      </Button>
    </div>
  )
}
