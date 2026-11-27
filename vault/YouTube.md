---
tags: [site]
---
# YouTube

## Track list
`hook.js` reads `movie_player.getPlayerResponse().captions.playerCaptionsTracklistRenderer`:
- `captionTracks`: `baseUrl`, `languageCode`, `kind: 'asr'` for auto-generated, `isTranslatable`
- `translationLanguages`: what auto-translate can produce

YouTube is a single-page app, so the player response lags behind the URL after navigating. The content script asks every 750 ms until the response's `videoId` matches the URL (up to 18 s).

## The caption token
Caption URLs (`/api/timedtext`) return an **empty 200** unless they carry a proof-of-origin token (`pot`) made by the player. The `baseUrl` in the track list doesn't have one.

What the extension does:
1. `hook.js` wraps `XMLHttpRequest.open` and `fetch` and reports every `/api/timedtext` URL the player requests
2. To load a track, the content script has the hook call `setOption('captions', 'track', { languageCode, kind })`, so the player requests that track with its token
3. A URL for any track of the same video is that track's `baseUrl` plus the token parameters borrowed from the latest token-carrying request (`pot`, `potc`, `c`, `cver`, …), with `fmt=json3`, and `tlang=<code>` for auto-translate
4. Right after a page loads, the player requests captions **before it has a token**. Those URLs are a last resort, and loading backs off (0, 1.5, 3, 6 s) before trying the plain `baseUrl`

Found in testing ([[Log/2026-11-27]]): with immediate retries, every attempt finished before the token existed and the caption line stayed empty.

## Format
- `json3` events: `tStartMs`, `dDurationMs`, `segs[].utf8`
- Auto-generated tracks roll up: each line lingers while the next appears, and `aAppend` events add the line breaks. The parser drops `aAppend` events and ends each line where the next starts, so one line shows at a time

## Auto-translate
`tlang=<code>` returns YouTube's machine translation of any translatable track, timed like the original. It's the translation line when there's no human track in your language.

## Other
- YouTube's own captions (`.ytp-caption-window-container`) are hidden while the overlay is active. Because the extension switches them on to get the token, they show again if the extension is turned off
- Nothing is drawn during ads (`#movie_player.ad-showing`)
- Captions lift 52 px while the control bar shows (no `ytp-autohide` class)
- `/watch` pages only: not Shorts, and not YouTube players embedded in other sites
- **Not yet checked on real YouTube**, which blocks the automated test browser. See [[Testing]]
