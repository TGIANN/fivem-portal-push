# Update API

FiveM Portal Push can send an update note to **your own site** every time you push a new version to the Cfx.re Portal. Your site stores it however it likes: a changelog page, a database row, a forum post. This page is everything you need to build the receiving side.

- [When the app calls your API](#when-the-app-calls-your-api)
- [Set it up in the app](#set-it-up-in-the-app)
- [Authentication](#authentication)
- [Endpoints](#endpoints)
  - [`GET <url>` connection test](#get-url-connection-test)
  - [`POST <url>` create an update](#post-url-create-an-update)
  - [`POST <url>/<id>/images` add an image](#post-urlidimages-add-an-image)
- [Errors](#errors)
- [Example servers](#example-servers)
- [Try it with curl](#try-it-with-curl)
- [What else leaves the app](#what-else-leaves-the-app)

## When the app calls your API

On the script screen, the **Update post** section has a switch for your API (shown as "Post to *your host*") and one for Discord. When the API switch is on, a push runs:

1. Write the version to `fxmanifest.lua`, zip, upload to the portal, wait until the portal says the version is active.
2. **`POST <url>`** with the update.
3. **`POST <url>/<id>/images`** once per image, in the order the user picked them.
4. Discord, if that switch is on. When your answer has a `url`, the Discord title links to it.
5. Git commit and push, if that switch is on.

Your API is only called after the portal version is live. If your API fails, the portal version stays, the git step still runs, and the app shows your error message with a **Post update again** button.

## Set it up in the app

**Settings → Update API**

| Field | What to enter |
| --- | --- |
| URL | The base URL of your endpoint, for example `https://example.com/api/updates`. Must be `https`; `http://localhost` and `http://127.0.0.1` are allowed for testing. A trailing `/` is removed. |
| Key | Any secret string your server checks. Stored encrypted on the user's PC (Windows DPAPI) and never shown again. |

**Test connection** calls `GET <url>` and shows your answer.

**Settings → Update post** sets whether the API switch starts on for every script.

## Authentication

Every request carries:

```http
Authorization: Bearer <key>
User-Agent: FiveM-Portal-Push/<app version>
Accept: application/json
```

Compare the whole header with your key in constant time and answer `401` when it does not match. Do not accept requests when your key is not configured.

**Redirects.** If your URL redirects (for example `example.com` → `www.example.com`), the app follows it and keeps the key, but only while the host stays the same apart from a leading `www.`. A redirect to another site, or from `https` to `http`, fails with a message asking the user to put the final URL in Settings. The key is never sent to another site.

## Endpoints

| Method | Path | Body | Your answer |
| --- | --- | --- | --- |
| `GET` | `<url>` | none | `200`, optionally `{ "name": "..." }` |
| `POST` | `<url>` | JSON update | `200` or `201` with `{ "id": ... }` |
| `POST` | `<url>/<id>/images` | `multipart/form-data`, one file in `image` | any `2xx` |

`<id>` is the `id` you returned from `POST <url>`, URL-encoded.

### `GET <url>` connection test

Called by **Test connection** in Settings. Check the key and answer `200`.

```json
{ "name": "My Store" }
```

| Field | Type | Required | Used for |
| --- | --- | --- | --- |
| `name` | string | no | Shown as "Connected to My Store (example.com)". Without it the app shows "Connected to example.com". |

### `POST <url>` create an update

Request:

```http
POST /api/updates HTTP/1.1
Content-Type: application/json
Authorization: Bearer <key>
```

```json
{
  "script": "tgiann-inventory",
  "version": "1.4.1",
  "beta": false,
  "package": { "id": 5123456, "name": "TGIANN Inventory" },
  "notes": "- Added camera modes\n- Fixed a crash when the phone closes",
  "changedFiles": "modified:   client/main.lua\n+new:       shared/hooks.lua\n-deleted:   server/legacy.lua",
  "imageCount": 2
}
```

| Field | Type | Always sent | Description |
| --- | --- | --- | --- |
| `script` | string | yes | Resource folder name, for example `tgiann-inventory`. |
| `version` | string | yes | The version just pushed, without a leading `v`: `1.4.1`, or `1.4.1-b1` for a beta. |
| `beta` | boolean | yes | `true` when the version ends in `-b1`, `-beta2`, `-rc1` and so on. The portal stores these as release candidates. |
| `package` | object or `null` | yes | The Tebex package picked in the app: `{ "id": number, "name": string }`. `null` when the user did not pick one, for example when no Tebex key is set. |
| `notes` | string | yes | The update notes the user wrote, as markdown. Can be empty: reject it with `400` if you require notes. |
| `changedFiles` | string | yes | Changed files, one per line, git status style. Can be empty. See below. |
| `imageCount` | number | yes | How many images will follow with `POST <url>/<id>/images` (0 to 10). |

`changedFiles` lines look like this. The labels are padded to 12 characters, so the text lines up in a monospace block:

```text
modified:   client/main.lua
+new:       shared/hooks.lua
-deleted:   server/legacy.lua
modified:   ui/build (delete the 'ui/build' folder before updating the 'ui/build' folder)
```

The `+` and `-` prefixes make it render in colour inside a ` ```diff ` block, which is how the Discord post shows it. The user can edit this text before pushing, so treat it as free text.

Answer `200` or `201`:

```json
{
  "id": 42,
  "url": "https://example.com/updates/inventory/v1-4-1",
  "linkLabel": "Read the full update"
}
```

| Field | Type | Required | Used for |
| --- | --- | --- | --- |
| `id` | string or number | **yes** | Used in the image URLs, so only letters, digits, `-` and `_`, up to 64 characters. Without a valid id the app reports that the answer has no usable id. |
| `url` | string | no | Public page for this update. Must start with `http://` or `https://`. The Discord title links to it. |
| `linkLabel` | string | no | When set together with `url`, the Discord post ends with a line `🌐 [linkLabel](url)`. Brackets and line breaks are removed and it is cut at 100 characters. |

**Duplicates.** The same script and version can arrive twice, for example when the user presses **Post update again** after Discord failed. Answer `409` with a clear `error` message instead of saving a second copy.

### `POST <url>/<id>/images` add an image

Sent once per image after the update is created, only when `imageCount` is above 0.

```http
POST /api/updates/42/images HTTP/1.1
Content-Type: multipart/form-data; boundary=...
Authorization: Bearer <key>
```

| Part | Content |
| --- | --- |
| `image` | One file, with its original file name and a `Content-Type` of `image/png`, `image/jpeg`, `image/webp` or `image/gif`. |

Answer any `2xx`; the body is not read. Up to 10 images, one request each, so a single request stays under common body limits (Vercel allows about 4.5 MB per request). If you have a size limit, answer `413` with a message such as `{ "error": "shot.png is too large (max 3.5 MB)" }`.

If an image fails, the update itself is already saved. The app says so: "The update was saved, but image shot.png failed. …".

## Errors

Answer with a non-2xx status and a JSON body:

```json
{ "error": "Pick the Tebex package for this update" }
```

`message` is read too when there is no `error`. Short plain-text bodies work. Messages longer than 300 characters are cut. HTML error pages are ignored, so the user sees the status instead of markup.

What the user sees in the app:

| Your answer | Message in the app |
| --- | --- |
| `401` or `403` | `example.com did not accept the API key (HTTP 401 Unauthorized): <your error>. Check the key in Settings.` |
| `404` or `405` | `example.com has no Update API at https://example.com/api/updates (HTTP 404 Not Found). Check the URL in Settings.` |
| any other non-2xx | `example.com answered HTTP 409 Conflict: <your error>` |
| `2xx` without a valid `id` on create | `example.com answered without a usable update id. The answer must be JSON with the new update's "id": …` |
| no connection, DNS, TLS, or no answer within 30 seconds (2 minutes for uploads) | `Could not reach example.com: <reason>` |

Write `error` for the person pushing: say what to change, for example "Write the update notes" or "This package already has an update for v1.4.1".

## Example servers

### Next.js route handler

`app/api/updates/route.ts`:

```ts
import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

function authorized(req: NextRequest): boolean {
  const key = process.env.UPDATE_API_KEY
  if (!key) return false
  const given = Buffer.from(req.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${key}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  return NextResponse.json({ name: 'My Store' })
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  const body = await req.json()
  if (!body.notes?.trim()) return NextResponse.json({ error: 'Write the update notes' }, { status: 400 })

  // Save it: body.script, body.version, body.package?.id, body.notes, body.changedFiles
  const id = await saveUpdate(body)

  return NextResponse.json({ id, url: `https://example.com/updates/${id}` }, { status: 201 })
}
```

`app/api/updates/[id]/images/route.ts`:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!authorized(req)) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  const { id } = await params
  const image = (await req.formData()).get('image')
  if (!(image instanceof File)) return NextResponse.json({ error: 'No image in the request' }, { status: 400 })

  await saveImage(id, image.name, Buffer.from(await image.arrayBuffer()))
  return NextResponse.json({ ok: true })
}
```

### Express

```js
import express from 'express'
import multer from 'multer'

const app = express()
const upload = multer({ limits: { fileSize: 8 * 1024 * 1024 } })
const KEY = process.env.UPDATE_API_KEY

app.use('/api/updates', (req, res, next) =>
  KEY && req.get('authorization') === `Bearer ${KEY}` ? next() : res.status(401).json({ error: 'Invalid API key' })
)

app.get('/api/updates', (req, res) => res.json({ name: 'My Store' }))

app.post('/api/updates', express.json(), async (req, res) => {
  const { script, version, package: pkg, notes, changedFiles } = req.body
  if (await exists(script, version)) return res.status(409).json({ error: `${script} already has an update for v${version}` })
  const id = await saveUpdate({ script, version, packageId: pkg?.id ?? null, notes, changedFiles })
  res.status(201).json({ id })
})

app.post('/api/updates/:id/images', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image in the request' })
  await saveImage(req.params.id, req.file.originalname, req.file.buffer)
  res.json({ ok: true })
})

app.listen(3000)
```

## Try it with curl

```bash
KEY=your-key
URL=https://example.com/api/updates

curl -H "Authorization: Bearer $KEY" $URL

curl -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"script":"my-script","version":"1.0.1","beta":false,"package":null,"notes":"- Test","changedFiles":"","imageCount":1}' \
  $URL

curl -H "Authorization: Bearer $KEY" -F "image=@shot.png;type=image/png" $URL/42/images
```

## What else leaves the app

The update API only receives the requests above. For completeness, this is all the update feature sends and reads:

| Where | When | What |
| --- | --- | --- |
| Your update API | API switch on | The requests on this page. |
| Discord | Discord switch on | One message: the role mention, or `@here` / `@everyone` when allowed in Settings (if picked), an embed with the package name (or script name), `v<version>`, the notes and your `url`/`linkLabel` if the API returned them, a second embed with the changed files as a `diff` block, and the images as attachments. Sent with your webhook, or with your bot to the channel in Settings. |
| Discord API | Bot mode, role picker or Test connection | Reads the channel to find its server, then the server's role list. Nothing is written. |
| Tebex Headless API | Package picker or Test connection | Reads your package list (`id`, `name`) with the public token. Nothing is written. |

Nothing is sent to TGIANN or any other third party.
