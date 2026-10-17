<p align="center">
  <img src="docs/banner.svg" alt="FiveM Portal Push" width="100%">
</p>

<p align="center">
  A Windows desktop app that turns "update the script on the Cfx.re Portal" into one button.<br>
  It bumps the version in <code>fxmanifest.lua</code>, zips the resource, uploads it as a new portal version, posts the update notes to your site or Discord, and can commit and push the folder to GitHub.
</p>

> [!NOTE]
> **This project was built with AI.** The code, the design, this README and the diagrams were written by Claude (Anthropic's AI model) inside [Claude Code](https://claude.com/claude-code), driven step by step by a human maintainer who set the requirements, tested every build against the real Cfx.re Portal and reported back what broke. Treat it like any other community tool: read the code before you trust it with your account.

> [!WARNING]
> Cfx.re does not offer a public API for the Portal. This app talks to the same endpoints the portal website uses, so a change on their side can break it at any time. It is not affiliated with or endorsed by Cfx.re, Rockstar Games or Tebex.

<p align="center">
  <img src="docs/screenshot-main.png" alt="FiveM Portal Push main window with a script selected" width="100%">
</p>

## Why

Shipping an update to a paid FiveM resource used to look like this: open `fxmanifest.lua` and guess the next version, check what is already on the portal, zip the folder by hand (without `.git`, `node_modules` and the files you forgot about), delete an old version because the portal only keeps five, upload, write a changelog from memory, then remember to commit. FiveM Portal Push does all of that from one screen.

## Features

- **Every script in one list.** Point it at your `resources` folders; every folder with an `fxmanifest.lua` shows up, with scripts that have uncommitted changes on top. Search, filter and sort by name, version or last push.
- **Knows what is live.** Shows the versions already on the portal next to the one in `fxmanifest.lua` and suggests the next version, so you never upload the same number twice.
- **Beta releases.** A version ending in `-b1`, `-b2`, `-beta1` or `-rc1` is uploaded as a release candidate.
- **Handles the 5 version limit.** When the asset already has five versions, the oldest one is removed before the upload. The list shows which one beforehand.
- **Changelog from git.** Prefilled with the files that changed since your last push. The portal renders release notes as Markdown, so the list goes inside a code block to keep one file per line:
  ```
  modified:   client/main.lua
  modified:   fxmanifest.lua
  +new:       client/integrations/
  -deleted:   server/old.lua
  modified:   ui/build (delete the 'ui/build' folder before updating the 'ui/build' folder)
  ```
- **Zip rules you can see.** Browse the resource as a tree and untick whatever should stay out of the zip. Rules are saved in a `.portalignore` file inside the resource, so they travel with git to every PC. Rules for all scripts live in the app.
- **More than one folder in a zip.** Add other resources (a shared library, a bridge) or loose files like install notes to the same upload. They sit next to the script folder at the zip root.
- **Remembers the portal asset.** Pick the matching portal asset once (exact name matches are linked automatically) and it is selected for you next time.
- **Update post.** After the upload is live, post the update notes, changed files, package name, a role tag and images to your own site and/or Discord (webhook or bot).
- **Optional GitHub step.** Commits only that resource folder as `<name> <version>` and pushes the current branch.
- **Log in with the browser you already use.** No passwords and no copied cookies (see below).
- **Clear errors.** Every step shows its own status, and everything goes to a log file you can open from the app.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshot-push.png" alt="Push progress with every step finished"></td>
    <td width="50%"><img src="docs/screenshot-zip.png" alt="Zip contents tree with excluded files"></td>
  </tr>
  <tr>
    <td align="center"><sub>Every push step with its own status</sub></td>
    <td align="center"><sub>Untick files and folders to keep them out of the zip</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshot-update.png" alt="Update post section with package, role tag and notes"></td>
    <td width="50%"><img src="docs/screenshot-settings.png" alt="Settings window with GitHub, update post, API and Discord settings"></td>
  </tr>
  <tr>
    <td align="center"><sub>Post the update to your site and Discord with the push</sub></td>
    <td align="center"><sub>Defaults and connections in Settings</sub></td>
  </tr>
</table>

<sub>Screenshots use demo data. Regenerate them with <code>npm run screenshots</code>.</sub>

## How it works

<p align="center">
  <img src="docs/flow.svg" alt="Push pipeline: pick a script, bump version, zip, free a slot, upload, update post, GitHub" width="100%">
</p>

1. **Pick a script** from the sidebar. The linked portal asset and its current versions load on the right.
2. **Choose the version.** Patch, minor, major and beta buttons are calculated from the higher of the local and the portal version, or type your own.
3. **Check the changelog**, the zip contents, the update post and the GitHub switch, then press **Push**.
4. The app writes the version into `fxmanifest.lua`, zips the folder (the zip root is the resource name, as the portal expects, plus any extra content), frees a version slot if needed, uploads the zip in 2 MB chunks and waits until the portal marks the version as active.
5. If an update post target is on, it sends the update notes to your API and/or Discord.
6. If the GitHub switch is on, it commits only that folder and pushes.

The gear button in the sidebar opens **Settings**: which switches start on for every script, and the connections for the update API, Discord and Tebex.

The changelog is stored as the changelog of that portal version. The asset description is not touched.

## Logging in

<p align="center">
  <img src="docs/login.svg" alt="Browser login sequence" width="100%">
</p>

The portal signs you in through the Cfx.re forum. Google and Discord sign-in do not work inside embedded app windows, so the app borrows your normal browser for the one step that needs it:

1. The app asks the portal for a login link inside its own session.
2. A small browser extension opens that link in your browser, where you are already logged in on the forum.
3. The forum sends a one-time code back to the portal. The extension catches it, closes the tab and hands the code to the app.
4. The app finishes the login itself and keeps its own portal session.

Your browser's cookies are never read or copied, and your browser stays logged in. A fallback "Log in inside the app" window is in the `...` menu.

## Install

1. Download the latest **`FiveM-Portal-Push-Setup-x.y.z.exe`** (installer) or **`FiveM-Portal-Push-x.y.z-portable.exe`** from [Releases](../../releases).
2. Download **`FiveM-Portal-Push-Connector-x.y.z.zip`** from the same release and extract it.
3. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, click **Load unpacked** and pick the extracted folder. The installed app also ships the extension; `...` → **Open browser extension folder** shows where.
4. Start the app, click **Log in with browser**, then add your script folder with the folder button in the sidebar.

The app opens the login page in your **default** browser, so install the extension there. Chromium browsers (Chrome, Edge, Brave, Opera) are supported.

Tip: pass a resource folder to open it straight away, for example from a shortcut or an Explorer script:

```
"FiveM Portal Push.exe" "C:\server\resources\[scripts]\my-script"
```

## Zip rules

The tree in **Zip contents → Browse files** writes to `<resource>/.portalignore`. You can also edit it by hand; it uses gitignore-like patterns:

```gitignore
# folders
docs/
ui/src/

# any file with this extension, in any folder
*.psd

# one exact file
client/test.lua
```

Always skipped: `.git`, `.github`, `.vscode`, `.idea`, `node_modules`, `*.zip`, `.gitignore`, `.portalignore`, `.portalbundle`, and files that usually hold passwords or keys: `server.cfg`, `.env*`, `.ssh`, `.git-credentials`, `.npmrc`, `id_rsa*`, `*.key`, `*.pem`, `*.pfx`. Files that are not zipped are left out of the changelog too.

## Extra content

**Extra content → Add folder / Add file** puts more than the script folder in the zip. The list is saved to `<resource>/.portalbundle`, one entry per line, relative to the resource. Add `-> name` to give an entry another name or path inside the zip:

```text
# another resource, zipped with its own .portalignore
../my-lib

# a loose file at the zip root, renamed
../../docs/INSTALL.md -> README.md
```

The zip then holds `my-script/`, `my-lib/` and `README.md`. Sources must sit inside the script's git repo or one of your script folders (never your home folder itself) and can not be secret files like `server.cfg`, `.env` or `.git`, so a `.portalbundle` that came with someone else's resource can not pull in files from elsewhere on your PC. The version is written only to the script's own `fxmanifest.lua`, and the GitHub step commits only the script folder.

## Update post

The **Update post** section on a script sends an update note after the portal upload is live. It has two targets, each with its own switch. **Settings** sets which ones start switched on.

- **Update API:** your own site. Set the URL and key in Settings; see [docs/update-api.md](docs/update-api.md).
- **Discord:** a webhook, or a bot token with a channel ID. A bot also lists the server roles you can tag. With a webhook you paste the role ID. `@here` and `@everyone` can be tagged only after you allow them in Settings, Discord.

The post contains the update notes you write, the changed files from the changelog, the Tebex package (picked from your store with the Tebex public key, matched by name the first time), the role to tag and up to 10 images. The Discord message is two embeds: the notes with the package name and version, and the changed files as a `diff` block. If the API answers with a page URL, the Discord title links to it.

A failed post does not undo the upload. The progress list shows the error and a **Post update again** button.

### Update API

Any site can take the updates: it needs three small endpoints (a connection test, create an update, add an image) behind a Bearer key. The requests, every field, the answers the app expects and example servers are in **[docs/update-api.md](docs/update-api.md)**.

## Your data

| What | Where |
| --- | --- |
| Settings, asset links, rules for all scripts, Tebex package links | `%APPDATA%/fivem-portal-push/config.json` |
| API key, Discord bot token and webhook URL, encrypted with Windows DPAPI | `%APPDATA%/fivem-portal-push/secrets.json` |
| Log file | `%APPDATA%/fivem-portal-push/logs/portal-push.log` |
| Portal session | the app's own browser profile in the same folder |
| Zip rules for one script | `<resource>/.portalignore` |
| Extra content for one script | `<resource>/.portalbundle` |

Nothing is sent anywhere except to `portal-api.cfx.re`, `portal.cfx.re`, `forum.cfx.re`, your own git remote and, only when you set them up, your update API, `discord.com` and `headless.tebex.io`. During login the app listens on `127.0.0.1:47821` for a few minutes so the extension can hand over the code. The log contains request paths and status codes, never cookie values.

## Changelog

What changed in each version is in [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
npm install
npm run dev          # start the app with hot reload for the UI
npm run typecheck
npm run build        # compile main, preload and renderer into out/
npm run dist         # build the installer and portable exe into dist/
npm run icons        # regenerate icons from build/icon.svg
npm run demo         # open the app with made-up scripts and a fake portal
npm run screenshots  # capture docs/screenshot-*.png from the demo
```

Changes in `src/main` or `src/preload` need a restart of `npm run dev`.

```
src/
  main/        Electron main process: portal API, login, zip, git, push pipeline
  preload/     the window.api bridge
  renderer/    React UI (Tailwind v4, Radix, motion)
  shared/      types and version helpers used by both sides
extension/     the browser connector (Manifest V3)
build/         app icon sources
docs/          README images
```

Portal endpoints used (`https://portal-api.cfx.re/v1/`): `auth/discourse`, `me/assets`, `assets/{id}`, `assets/{id}/re-upload`, `assets/{id}/versions/{vid}/upload-chunk`, `assets/{id}/versions/{vid}/complete-upload` and `DELETE assets/{id}/versions/{vid}`.

Stack: Electron, electron-vite, React 19, TypeScript, Tailwind CSS v4, Radix UI, Font Awesome, yazl.

## Releasing

Publishing a GitHub release builds the app automatically:

1. Add the version to [CHANGELOG.md](CHANGELOG.md), then create a release with a tag like `v1.2.0` (or `v1.3.0-beta.1`) and publish it. Use the changelog section as the release notes.
2. The [Release workflow](.github/workflows/release.yml) takes the version from the tag, writes it into `package.json` and the extension manifest, type-checks, builds on Windows and attaches the installer, the portable exe and the extension zip to the release.

To rebuild an existing release, run the workflow by hand from the Actions tab and enter its tag.

## License

[MIT with the Commons Clause](LICENSE). You can use FiveM Portal Push for anything, including shipping your own paid scripts, and you can change it and share your changes. You can not sell it, or a version of it, or charge for a service that is mostly this app. Keep the license notice in copies and forks.

## Credits

- The portal endpoints were first mapped by [Tynopia/cfx-portal-upload](https://github.com/Tynopia/cfx-portal-upload) (MIT), a GitHub Action for the same job.
- Built with [Claude Code](https://claude.com/claude-code).
