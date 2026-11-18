import { app, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function takeScreenshots(win: BrowserWindow): Promise<void> {
  const out = join(app.getAppPath(), 'docs')
  mkdirSync(out, { recursive: true })

  const click = async (selector: string, text?: string): Promise<void> => {
    const found = await win.webContents.executeJavaScript(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
      const el = ${text ? `els.find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))` : 'els[0]'}
      el?.click()
      return Boolean(el)
    })()`)
    if (!found) {
      const labels = await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('[role="dialog"] button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim()).slice(0, 20).join(' | ')`
      )
      throw new Error(`Screenshot step failed: ${selector} ${text ?? ''}. Dialog buttons: ${labels || 'no dialog'}`)
    }
  }

  const shot = async (name: string): Promise<void> => {
    await wait(700)
    const image = await win.webContents.capturePage()
    writeFileSync(join(out, name), image.toPNG())
    console.log(`saved docs/${name}`)
  }

  await wait(1500)
  await click('aside button', 'tgiann-phone')
  await shot('screenshot-main.png')

  await click('header button', 'Push')
  await wait(2500)
  await shot('screenshot-push.png')

  await click('button', 'Browse files')
  await wait(400)
  for (const name of ['art', 'client', 'ui', 'build']) {
    await click(`[aria-label="Expand ${name}"]`)
    await wait(150)
  }
  await shot('screenshot-zip.png')

  await click('[role="dialog"] button', 'Done')
  await wait(400)
  const scrolled = await win.webContents.executeJavaScript(`(() => {
    const h = [...document.querySelectorAll('h3')].find((e) => e.textContent === 'Update post')
    h?.scrollIntoView({ block: 'start' })
    return Boolean(h)
  })()`)
  if (!scrolled) throw new Error('Screenshot step failed: Update post section not found')
  await shot('screenshot-update.png')

  await click('[aria-label="Settings"]')
  await shot('screenshot-settings.png')

  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  await wait(500)
  await click('nav button', 'Download')
  await win.webContents.executeJavaScript('document.activeElement?.blur()')
  await wait(800)
  await click('button', 'Select updated')
  await click('main aside button', 'Download')
  await wait(2000)
  // The demo finds two folders already there and asks once.
  await click('[role="dialog"] button', 'Replace all')
  await click('[role="dialog"] footer button', 'Replace')
  await wait(600)
  await shot('screenshot-downloads.png')

  await click('nav button', 'Escrow')
  await click('main section button', 'Encrypt')
  await wait(2800)
  await shot('screenshot-encrypt.png')
}
