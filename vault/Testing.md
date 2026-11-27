---
tags: [testing]
---
# Testing

## In the repository
`node tests/parsers.test.mjs`: WebVTT, SRT, ASS, json3 (with roll-up), format detection, language from file names, cue lookup, and regional varieties. The variety tests cover:
- tags and aliases
- which track wins for Spain, Mexico and Puerto Rico Spanish, and for Portuguese, English, French, Chinese and Arabic varieties
- Catalan's Valencian variant tag
- defaults from the browser language
- names
- DeepL and on-device targets

## Browser tests (Playwright)
These ran from the session scratchpad with Playwright 1.47 and its Chromium 129, which can still load unpacked extensions from the command line (branded Chrome 137+ can't). **The scripts aren't in the repository yet** (see [[Known issues and next steps]]).

| Suite | What it checks | 2026-11-27 |
|---|---|---|
| Video page | Local page with a generated video and Spanish/English `<track>`s: both lines, clickable words, native tracks hidden, timing, A/D, word popup, add as important, highlighting, Learnt from the popup, Esc, popup track list and swapping lines, dropped `.srt`, blur and text size, fullscreen, narrow video | 22/22 |
| Library page | Seeded words: order, counts, tabs, search, language filter, inline edit, ★ and Learnt, add by hand, review with keys, CSV export, no sideways scroll at 390 px, empty state | 21/21 |
| YouTube (simulated) | A stand-in watch page served at www.youtube.com with a fake player: track list, defaults, token reuse, early token-less requests, roll-up auto-captions, native captions hidden, auto-translate with the token, D, turning the extension off | 11/11 |
| Netflix (simulated) | A stand-in watch page: manifest request rewritten, tracks parsed (image-only and "off" skipped), WebVTT and TTML via the background worker, native subtitles hidden, seeking through the player API | 8/8 |
| Machine translation | A stand-in DeepL server: one batched request with the key and language codes, next line translated ahead, word lookup with context, bad-key message | 5/5 |
| Regional varieties | The simulated YouTube page with `es-ES`, `es-419`, auto-generated `es` and `en` tracks. Checks:<br>• the track chosen for Puerto Rico, Spain and Mexico Spanish<br>• auto-translate into `pt-PT`<br>• DeepL asked for `PT-PT`<br>• underlines for words saved with no region and for another region<br>• the word popup's region picker, "Saved for Spain" and dictionary links<br>• saving per region, and the video's region remembered<br>• toolbar popup region selects and the engine hint<br>• Library: chips, region filter, search by region, moving a word's region and refusing a clash, adding with a region<br>• voice choice from a stubbed voice list | 32/32 |
| Languages added in 0.2.1 | The popup:<br>• offers Andorra, Catalonia and Valencia for Catalan, and saves `ca-valencia`<br>• lists Galician, Basque, Irish and Welsh, with no region choice<br>• offers Afghanistan and Iran for Persian<br>In the Library, chips and the add form show the Catalan regions, and a Valencian word gets the Catalan voice | 8/8 |

Screenshots were checked by eye: light and dark mode, desktop and phone widths, the popup and the Library page. All six suites passed again after the regional varieties work (Library 21/21 after updating it to the filter's new values).

The Netflix and DeepL suites need `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`, which lets Playwright intercept the background worker's requests. Without it they fail with "Failed to fetch"

## Checked by hand
- **Real YouTube:** works (2026-11-27)

## Not tested yet
- **Real YouTube, automatically:** it blocks the automated browser: the player shows "Something went wrong", and even its own caption requests come back empty. Reading the real track list did work (65 tracks on a TED talk). Getting past YouTube's bot detection was ruled out
- **Real Netflix** needs an account
- **Chrome's on-device translator** isn't in Chromium 129
- **Real voices:** the voice choice was tested with a stubbed voice list; which voices exist depends on the system
- **The RAE dictionary link** (`dle.rae.es/<word>`) refuses automated requests (403), so only its URL form is known. The *Diccionario de americanismos* and Priberam links were checked and show regional meanings

## Lessons
- The simulated YouTube page caught a real bug that reading the code had missed: early token-less requests (see [[YouTube]])
- A test server for video needs Range support, or seeking leaves `currentTime` at 0
- Screenshots caught three layout problems the checks passed over: the word popup's region picker cut off, the add form's region squeezed to "Puert", and the region chips as wide as their longest option
