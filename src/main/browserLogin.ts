import { randomBytes } from 'crypto'
import { app, shell } from 'electron'
import { createServer, type Server } from 'http'
import { join } from 'path'
import { logoSvg } from '../shared/logo'
import { log } from './log'
import { completeSso, getSsoUrl } from './portal'

export const loginPort = 47821
const timeout = 5 * 60 * 1000
const maxBody = 64 * 1024

export function extensionDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'extension') : join(app.getAppPath(), 'extension')
}

let pending: { nonce: string; resolve: (ok: boolean) => void; server: Server; timer: NodeJS.Timeout } | null = null

function finish(ok: boolean): void {
  if (!pending) return
  const { resolve, server, timer } = pending
  pending = null
  clearTimeout(timer)
  server.close()
  resolve(ok)
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const copyRow = (value: string): string =>
  `<div class="row"><code>${escapeHtml(value)}</code><button type="button" class="copy" data-copy="${escapeHtml(value)}">Copy</button></div>`

const favicon = 'data:image/svg+xml,' + encodeURIComponent(logoSvg)

function page(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>FiveM Portal Push login</title><link rel="icon" href="${favicon}"><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#fff;font:15px/1.45 Inter,'Segoe UI',system-ui,sans-serif}
.card{width:460px;padding:28px;border-radius:14px;background:#1c1c1e}
h1{margin:0 0 6px;font-size:20px;font-weight:600}p{margin:0;color:rgba(235,235,245,.6)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#36ff9f;margin-right:8px}
.err{color:#ff4245}ol{margin:14px 0 0;padding-left:20px;color:rgba(235,235,245,.6)}li{margin:10px 0}li b{color:#fff;font-weight:600}
.row{display:flex;align-items:center;gap:4px;margin-top:6px;padding:4px 4px 4px 10px;border-radius:10px;background:rgba(120,120,128,.24)}
code{flex:1;min-width:0;color:#fff;font:12px Consolas,monospace;word-break:break-all;user-select:all}
.copy{flex-shrink:0;height:28px;padding:0 12px;border:0;border-radius:999px;background:rgba(120,120,128,.36);color:#fff;font:500 13px Inter,'Segoe UI',system-ui,sans-serif;cursor:pointer;transition:background-color .15s,transform .15s}
.copy:hover{background:rgba(120,120,128,.5)}.copy:active{transform:scale(.97)}.copy.done{background:#36ff9f;color:#333}
.copy:focus-visible{outline:2px solid #36ff9f;outline-offset:2px}
#help{display:none}
</style></head><body><div class="card"><h1 id="title">Connecting to FiveM Portal Push</h1><p id="text">Waiting for the browser extension</p>
<div id="help"><ol>
<li>Open the extensions page in a new tab:${copyRow('chrome://extensions')}${copyRow('edge://extensions')}</li>
<li>Turn on <b>Developer mode</b></li>
<li>Click <b>Load unpacked</b> and pick this folder:${copyRow(extensionDir())}</li>
<li>Click <b>Log in with browser</b> in the app again</li>
</ol></div></div><script>
const title=document.getElementById('title'),text=document.getElementById('text'),help=document.getElementById('help');
window.addEventListener('portal-push',e=>{const d=e.detail;title.textContent=d.state==='done'?'Connected':d.state==='error'?'Login failed':'Logging in';if(d.state==='done'){const dot=document.createElement('span');dot.className='dot';title.prepend(dot);}text.textContent=d.text;text.className=d.state==='error'?'err':'';});
document.addEventListener('click',async e=>{const b=e.target.closest('.copy');if(!b)return;try{await navigator.clipboard.writeText(b.dataset.copy);b.textContent='Copied';b.classList.add('done');setTimeout(()=>{b.textContent='Copy';b.classList.remove('done');},1500);}catch{b.textContent='Select and copy';}});
setTimeout(()=>{if(document.documentElement.dataset.ext)return;title.textContent='Install the browser extension';text.textContent='FiveM Portal Push uses a small extension to reuse this browser\\'s Cfx.re login. Set it up once:';help.style.display='block';},2500);
</script></body></html>`
}

export function browserLogin(onSuccess: () => void): Promise<boolean> {
  finish(false)
  const nonce = randomBytes(24).toString('hex')

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      // A web page that points its own domain at 127.0.0.1 arrives with that domain here.
      if (req.headers.host !== `127.0.0.1:${loginPort}`) {
        res.writeHead(403)
        res.end()
        return
      }
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${loginPort}`)

      if (req.method === 'GET' && url.pathname === '/connect') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(page())
        return
      }

      const reply = (status: number, data: object): void => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(data))
      }
      const expired = (n: string | null | undefined): boolean => !pending || n !== pending.nonce

      if (req.method === 'GET' && url.pathname === '/sso-url') {
        if (expired(url.searchParams.get('n'))) return reply(403, { ok: false, error: 'This login link expired. Start again from the app.' })
        getSsoUrl().then(
          (ssoUrl) => reply(200, { ok: true, url: ssoUrl }),
          (e) => reply(500, { ok: false, error: e instanceof Error ? e.message : String(e) })
        )
        return
      }

      if (req.method === 'POST' && url.pathname === '/sso') {
        let body = ''
        req.on('data', (c) => {
          body += c
          if (body.length > maxBody) req.destroy()
        })
        req.on('end', async () => {
          try {
            const data = JSON.parse(body) as { nonce: string; sso: string; sig: string }
            if (expired(data.nonce)) return reply(403, { ok: false, error: 'This login link expired. Start again from the app.' })
            log('auth', 'sso code received from browser')
            if (!(await completeSso(data.sso, data.sig))) return reply(500, { ok: false, error: 'The portal did not accept the login. Try again from the app.' })
            reply(200, { ok: true })
            onSuccess()
            finish(true)
          } catch (e) {
            reply(500, { ok: false, error: e instanceof Error ? e.message : String(e) })
          }
        })
        return
      }

      res.writeHead(404)
      res.end()
    })

    server.once('error', (e: NodeJS.ErrnoException) =>
      reject(new Error(e.code === 'EADDRINUSE' ? `Port ${loginPort} is used by another program. Close it and try again.` : e.message))
    )

    server.listen(loginPort, '127.0.0.1', () => {
      pending = { nonce, resolve, server, timer: setTimeout(() => finish(false), timeout) }
      shell.openExternal(`http://127.0.0.1:${loginPort}/connect?n=${nonce}`)
    })
  })
}

export function cancelBrowserLogin(): void {
  finish(false)
}
