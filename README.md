# Let's Copy

[![Build](https://github.com/NatLee/lets-copy/actions/workflows/build.yml/badge.svg)](https://github.com/NatLee/lets-copy/actions/workflows/build.yml)
[![Validate](https://github.com/NatLee/lets-copy/actions/workflows/validate.yml/badge.svg)](https://github.com/NatLee/lets-copy/actions/workflows/validate.yml)
[![Release](https://img.shields.io/github/v/release/NatLee/lets-copy?display_name=tag&sort=semver)](https://github.com/NatLee/lets-copy/releases/latest)

A Chrome extension that unlocks **copy**, **text selection**, and **right-click** on websites that disable them.

![](./doc/enable-csdn-code-block.png)

## Features

- 🔓 **Unlocks text selection** — overrides `user-select: none` and friends
- 📋 **Re-enables copy / cut / paste** — strips inline handlers and swallows `copy`/`cut`/`paste` blockers
- 🖱️ **Re-enables right-click** — installs capture-phase listeners *before* the page's own `contextmenu` handlers register, which is the only reliable way to defeat `addEventListener('contextmenu', ...)` locking
- ⚡ **Always-on mode** — auto-unlock every site you visit
- 🎯 **Per-site toggle** — remembered across sessions
- ⌨️ **Keyboard shortcut** — `Alt+Shift+C` to toggle the current site
- 🌓 **Dark mode** — the popup follows your system theme

## How it works

When a site is enabled, the extension registers a dynamic content script that runs at `document_start` in the page's MAIN world. This means our capture-phase listeners for `contextmenu`, `selectstart`, `copy`, `cut`, `paste`, and `dragstart` are installed *before* any of the page's own scripts can register theirs — so the page's blockers never see those events.

The extension also:
- Strips inline event attributes (`oncontextmenu`, `oncopy`, `unselectable`, …) on all existing and future elements via a `MutationObserver`
- Injects a high-specificity stylesheet that overrides `user-select: none` everywhere
- Handles CSDN's code-block trick via `document.designMode = 'on'`

## Install

### From a release

Download `lets-copy-vX.Y.Z.zip` from the [Releases page](https://github.com/NatLee/lets-copy/releases/latest), unzip it, then in Chrome:

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the unzipped folder

### From source

```bash
# Unix / git-bash
bash package.sh
```

```powershell
# Windows PowerShell
.\package.ps1
```

Both produce `lets-copy-vX.Y.Z.zip` at the repo root.

## Release process

The build workflow runs automatically when a `v*` tag is pushed:

```bash
# Bump src/manifest.json "version" first, then:
git commit -am "[update] bump to v2.1.0"
git tag v2.1.0
git push origin main --tags
```

The workflow validates the tag matches the manifest version, builds the zip, and creates a GitHub Release with the zip attached. If a `CRX_PRIVATE_KEY` secret is configured, a signed `.crx` is attached as well.

## Project layout

```
src/
├── manifest.json       MV3 manifest
├── background.js       Service worker — state, icon, injection
├── enable.js           Page-side unlock (MAIN world, document_start)
├── popup.html          Popup UI
├── popup.css           Popup styles (light/dark)
├── popup.js            Popup logic
└── icons/              Toolbar & store icons
```

## Privacy

See [PRIVACY.md](./PRIVACY.md). TL;DR: no data ever leaves your device.

## Icon credits

- Enable: <https://www.flaticon.com/free-icon/check_9902393?related_id=9902393&origin=pack>
- Disable: <https://www.flaticon.com/free-icon/copy_9902369?term=copy&page=1&position=13&origin=search&related_id=9902369>
