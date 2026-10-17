# Changelog

All notable changes to FiveM Portal Push. Versions follow [semantic versioning](https://semver.org/); the newest is on top.

## 1.2.0 - 2026-10-17

### Added

- **Site posts the Discord announcement** (Settings, Update API). When your update API implements the two optional endpoints, `GET <url>/roles` and `POST <url>/<id>/announce`, the role picker lists your site's roles and the site posts the announcement after the images. The app skips its own Discord post in that push. See [docs/update-api.md](docs/update-api.md).
- **Allow @here and @everyone** switches in Settings, Update post. Both are off by default. When one is on, it shows up in the script's tag list (bot mode) or as a button next to the role ID (webhook mode), and the post pings with it. While a switch is off, the app refuses to send that tag.

## 1.1.3 - 2026-10-16

### Security

- On Windows, zip rules ignore upper and lower case like the file system does, so `Server.CFG` or `.ENV` are skipped too.
- Extra content sources are resolved to their real path on disk before they are checked, and that same path is zipped. Windows aliases such as a trailing dot (`server.cfg.`), an NTFS stream (`server.cfg::$DATA`) or a short 8.3 name can no longer slip past the secret file check.
- Names inside the zip can not use characters Windows rejects (`< > : " | ? *`) or end in a dot or space, so buyers can unpack it cleanly.
- Only images picked with **Add images** can be uploaded with an update.
- A key, token or webhook URL is not saved at all when Windows can not encrypt it.
- Links opened from the app must be `https`.
- Requests to the update API, Discord and Tebex give up after 30 seconds (2 minutes for uploads) instead of hanging the push.
- The update API answer is checked: the `id` may only use letters, digits, `-` and `_`, and `linkLabel` loses brackets and line breaks before it goes into the Discord post. Server messages are cut at 300 characters.
- Role tags are only sent for numeric role IDs, and the Discord post never pings `@everyone` or `@here`.

## 1.1.2 - 2026-10-16

### Security

- Files that usually hold passwords or keys are never zipped, in the script folder or in extra content: `server.cfg`, `.env*`, `.git`, `.ssh`, `.gnupg`, `.aws`, `.git-credentials`, `.npmrc`, `id_rsa*`, `id_ed25519*`, `id_ecdsa*`, `*.key`, `*.pem`, `*.pfx`, `*.p12`. A `.portalbundle` entry that points at one of them is refused.
- Your home folder, or a folder that holds it, no longer counts as a place extra content may come from, even when it is a git repo or a script folder.

## 1.1.1 - 2026-10-16

### Security

- Extra content sources from `.portalbundle` must sit inside the script's git repo or one of your script folders, and never in the app's own data folder. Links that point outside are followed and checked too. Before this, a `.portalbundle` that came with someone else's resource could add any file on your PC to the portal upload.

## 1.1.0 - 2026-10-16

### Added

- **Update post.** After the portal upload is live, post the update to your own site and/or Discord in the same push. It carries the update notes, the changed files from the changelog, the Tebex package, a role to tag and up to 10 images.
  - **Update API:** any site can take the updates through three small endpoints behind a Bearer key. Every field and answer is described in [docs/update-api.md](docs/update-api.md).
  - **Discord:** send with a webhook, or with a bot token and channel ID. The bot mode lists the server roles to tag.
  - **Tebex:** pick the package from your store with the public key. It is matched by name the first time and remembered per script.
  - A failed post does not undo the upload. The git step still runs, and **Post update again** retries the post.
- **Settings window** (gear button in the sidebar):
  - choose which switches start on for every script: GitHub commit and push, update API, Discord
  - set up the update API, Discord and Tebex connections, each with a **Test connection** button
- **Extra content in the zip.** Add other resources (a shared library, a bridge) or loose files like install notes to the same upload. They sit next to the script folder at the zip root and can be renamed inside the zip. The list is saved to `.portalbundle` in the script folder, and each extra folder uses its own `.portalignore`.

### Changed

- The update API key, Discord bot token and webhook URL are stored encrypted with Windows DPAPI in `secrets.json`, apart from `config.json`. The window never receives them back.
- The GitHub switch only remembers a script's choice when it differs from the default in Settings. Changing the default resets those saved choices.
- The sidebar header fits the app name next to its buttons again.

## 1.0.0 - 2026-10-12

First public release.

- Lists every FiveM resource in your folders, changed scripts first
- Shows the versions already on the Cfx.re Portal and suggests the next one
- Writes the version into `fxmanifest.lua`; `-b1` style versions upload as a beta
- Frees a slot when the asset already has 5 versions
- Zips the resource with your `.portalignore` rules and uploads it
- Prefills the changelog from git
- Optionally commits the folder and pushes it to GitHub
- Logs in through the browser you already use, without copying cookies
