---
tags: [testing]
---
# Testing

## In the repository
`node tests/parsers.test.mjs`: WebVTT, SRT, ASS, json3 (with roll-up), format detection, language from file names, cue lookup and language codes.

## Browser tests (Playwright)
These ran from the session scratchpad with Playwright 1.47 and its Chromium 129, which can still load unpacked extensions from the command line (branded Chrome 137+ can't). **The scripts aren't in the repository yet** (see [[Known issues and next steps]]).

| Suite | What it checks | 2026-11-27 |
|---|---|---|
| Video page | Local page with a generated video and Spanish/English `<track>`s: both lines, clickable words, native tracks hidden, timing, A/D, word popup, add as important, highlighting, Learnt from the popup, Esc, popup track list and swapping lines, dropped `.srt`, blur and text size, fullscreen, narrow video | 22/22 |
| Library page | Seeded words: order, counts, tabs, search, language filter, inline edit, ★ and Learnt, add by hand, review with keys, CSV export, no sideways scroll at 390 px, empty state | 21/21 |
| YouTube (simulated) | A stand-in watch page served at www.youtube.com with a fake player: track list, defaults, token reuse, early token-less requests, roll-up auto-captions, native captions hidden, auto-translate with the token, D, turning the extension off | 11/11 |
| Netflix (simulated) | A stand-in watch page: manifest request rewritten, tracks parsed (image-only and "off" skipped), WebVTT and TTML via the background worker, native subtitles hidden, seeking through the player API | 8/8 |
| Machine translation | A stand-in DeepL server: one batched request with the key and language codes, next line translated ahead, word lookup with context, bad-key message | 5/5 |

Screenshots were checked by eye: light and dark mode, desktop and phone widths, the popup and the Library page.

## Not tested yet
- **Real YouTube** blocks the automated browser: the player shows "Something went wrong", and even its own caption requests come back empty. Reading the real track list did work (65 tracks on a TED talk). Getting past YouTube's bot detection was ruled out
- **Real Netflix** needs an account
- **Chrome's on-device translator** isn't in Chromium 129

## Lessons
- The simulated YouTube page caught a real bug that reading the code had missed: early token-less requests (see [[YouTube]])
- A test server for video needs Range support, or seeking leaves `currentTime` at 0
