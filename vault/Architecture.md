---
tags: [architecture]
---
# Architecture

A Manifest V3 Chrome extension with no build step: plain JavaScript files, loaded in order by `manifest.json`.

## Where code runs
| Where | Files | Why there |
|---|---|---|
| The page's own JavaScript (YouTube and Netflix only), from document start | `src/page/hook.js` | Only here can code see the player objects and wrap `XMLHttpRequest`, `fetch`, `JSON.parse` and `JSON.stringify` before the player uses them |
| Content script (every page, top frame) | `src/shared/*.js`, `src/content/*.js` | Draws the overlay; talks to extension storage and the background worker |
| Background service worker | `src/background.js` | Cross-origin requests a content script can't make: Netflix subtitle files and DeepL. Only it reads the DeepL key |
| Extension pages | `src/popup/`, `src/library/` | Toolbar popup and the Library tab |

## Messages
- **hook ⇄ content:** `window.postMessage({ dualcap: 'page' | 'content', type, payload })`. Types: `yt:getTracks`, `yt:tracks`, `yt:loadTrack`, `yt:timedtext`, `nf:getTracks`, `nf:tracks`, `nf:seek`, `nf:pause`, `nf:play`
- **content → background:** `dc:fetchText` (Netflix CDN only), `dc:deepl`
- **popup → content:** `dc:getState` (every second while the popup is open), `dc:select`
- **Storage:** `chrome.storage.local` keys `settings`, `deeplKey`, `library`. Every page listens for changes, so an edit anywhere shows up everywhere straight away

## Content script files
| File | Role |
|---|---|
| `shared/settings.js` | Defaults and the language list (shared with the popup) |
| `shared/library.js` | Library storage (shared with the popup and Library page). See [[Library]] |
| `content/parsers.js` | Subtitle parsers, cue lookup, file decoding. See [[Other sites and subtitle files]] |
| `content/translate.js` | Chrome's Translator API and DeepL. See [[Machine translation]] |
| `content/overlay.js` | Caption overlay in a shadow root, word popup, toasts |
| `content/sites.js` | One adapter per site: find the video, title, tracks, seek/pause. See [[YouTube]], [[Netflix]] |
| `content/main.js` | The controller (below) |
| `content/page.css` | Hides the site's own captions while the overlay is active |

## The controller (`main.js`)
- **Every 500 ms:** has the title changed (the adapter's `mediaKey`), has the video element changed
- **Subtitle line default:** a track in the language being learnt (manual before auto-generated), else the best-ranked track
- **Translation line, "Auto":** a human track in your language → YouTube auto-translate → machine translation. If the subtitles are already in your language, it translates into the language you're learning instead
- **Loading:** both tracks load in parallel; a load token drops results from a selection that has since been replaced
- **Drawing:** a `requestAnimationFrame` loop while there's a video and a track. The overlay is `position: fixed`, lined up with the video's rectangle each frame, and moved into the fullscreen element when there is one. Text is 4.3% of the video height × the size setting, 14–72 px
- **Pausing:** hovering the captions and the open word popup each hold a pause; playback resumes when the last hold is released, unless you pressed play yourself
- **Shortcuts:** matched on `KeyboardEvent.code` (the physical key), so they work in any keyboard layout. Ignored while typing in a field
