# Dual Captions

A Chrome extension for learning languages from video. It shows two subtitle lines at once (the language you're learning, with a translation underneath) on YouTube, Netflix and any page with an HTML5 video. Click any word to look it up and save it to your **Library**, where you can track which words you're still learning, which you've learnt, and which are important.

## Why I built this

I've always had a big interest in learning new languages. I've used the existing services, but felt their paywalls were a big restriction, so I made my own. Dual Captions is free, needs no account or subscription, and keeps everything you save in your own browser.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this folder (`dual-captions`).
3. Pin the extension, click its icon, and set **I'm learning** / **I speak**, with a region if it matters to you (Spanish from Spain, Mexico or Puerto Rico, Brazilian or European Portuguese…).

This works in Chrome, Edge, Brave and other Chromium browsers. After editing the code, click the reload icon on the extension's card and refresh any open video tabs.

## Using it

**While watching**
- Two lines appear over the video. If the site has a human subtitle track in your language, that's used for the bottom line. Otherwise YouTube's auto-translate is used, and failing that, machine translation.
- Hovering over the captions pauses the video (you can turn this off). **Click a word** to see its meaning, hear it, open a dictionary, and **add it to your library** (optionally ★ important).
- Words already in your library are underlined in the captions: blue while you're learning them, gold if marked important.
- The popup lets you pick which track goes on which line for the current video.
- Drop an `.srt`, `.vtt`, `.ass` or `.ttml` file onto the page to use your own subtitles. A language code in the file name (`movie.es.srt`) decides which line it goes on.

| Key | Action |
| --- | --- |
| `A` | previous line |
| `R` | replay current line |
| `D` | next line |
| `Q` | pause after each line on/off |
| `W` | blur translation until hovered on/off |
| `Esc` | close the word popup |

**Library** (popup → *Open library*, or the extension's Options page)
- Every saved word keeps its meaning, a note you can edit, the caption line it came from (plus its translation), and a ▶ link back to that moment in the video.
- Filter by *Learning*, *Learnt* or *★ Important*, search, filter by language, and edit meanings and notes inline.
- **Review**: flashcards for the words you're still learning, important ones first. *Got it* marks a word learnt.
- **Export** as CSV (importable into Anki or a spreadsheet), or back up to and restore from a JSON file.
- Add words by hand with **+ Add word**.

## Regional varieties

Languages differ from place to place: a *guagua* is a bus in Puerto Rico and a baby in Chile. Under each language in the popup you can pick a region. Spanish has Spain, Mexico, the US, Puerto Rico, Cuba, the Dominican Republic, Colombia, Venezuela, Peru, Chile, Argentina, or Latin America in general. Portuguese, English, French, German, Dutch, Chinese and Arabic have regions too.

- **Subtitles:** the closest track is chosen. If you're learning Puerto Rican Spanish and a video has Spain and Latin American subtitles, you get the Latin American ones. Human subtitles still come before auto-generated ones.
- **Translations:** YouTube auto-translate and DeepL use your region where they have it. DeepL has British and American English, European and Brazilian Portuguese, Latin American Spanish, and Simplified and Traditional Chinese. Chrome's on-device translator has no regions; the popup tells you when that applies.
- **Each video's region** comes from its subtitles when they say. Otherwise, set it in the word popup or the toolbar popup ("Where this Spanish is from"). It's remembered for that video.
- **Library:**
  - Words are saved per region, so *guagua* for Puerto Rico and *guagua* for Chile are separate entries.
  - A word saved only for another region gets a dotted underline in the captions, and its popup shows that meaning.
  - You can change a word's region on its card, filter and search by region, and the CSV export has a `variety` column.
- **Pronunciation** uses the closest accent your system has.
- **Dictionaries:** every word links to Wiktionary, which labels regional meanings. Spanish words also link to the RAE dictionary, or for Latin American Spanish to the *Diccionario de americanismos*, which lists meanings country by country. Portuguese words also link to Priberam.

## Machine translation

Machine translation is only used for lines that have no human or YouTube translation, and for word lookups.

- **Chrome on-device** (default): free and private, needs Chrome 138+ on desktop. The first time you use a language pair, the translation line asks you to click it so Chrome can download that model.
- **DeepL**: paste an API key in the popup. The free tier gives 500,000 characters a month. Upcoming lines are translated in batches, ahead of time.
- **Off**: you'll only see human tracks and YouTube auto-translate.

## How it works

| File | Role |
| --- | --- |
| `src/page/hook.js` | Runs inside YouTube/Netflix's own page context. On YouTube it records the caption requests the player makes (they carry a short-lived token YouTube requires) and drives the player's caption setting. On Netflix it asks the manifest for text subtitles in every language, reads the subtitle list, and seeks through Netflix's player API (setting `video.currentTime` makes Netflix error). |
| `src/content/sites.js` | One adapter per site: find the video, list tracks, seek/pause. |
| `src/content/main.js` | Picks tracks, renders both lines in sync, translation queue, shortcuts, word popup, saving to the library. |
| `src/content/overlay.js` | The caption overlay (in a shadow root, so site CSS can't touch it). |
| `src/content/parsers.js` | WebVTT, SRT, ASS/SSA, TTML/DFXP and YouTube json3 parsers. |
| `src/content/translate.js` | Chrome Translator API and DeepL (via `src/background.js`). |
| `src/shared/settings.js` | Default settings and regional varieties: which regions are close to each other, and how tracks, voices and translation targets are matched. |
| `src/shared/library.js` | Library storage (`chrome.storage.local`), shared by all pages. |
| `src/popup/`, `src/library/` | The toolbar popup and the Library page. |

Everything is stored locally in your browser. Nothing is sent anywhere except subtitle downloads from the sites themselves, and DeepL requests if you choose DeepL.

## Limitations

- YouTube and Netflix integration relies on their players' internal behaviour, which they can change without notice. If captions stop appearing, those adapters are the place to look first.
- Only the top-level page is covered, so videos embedded in iframes on other sites aren't.
- On sites that make the `<video>` element itself fullscreen (rather than its container), the overlay can't be drawn on top.

## Tests

```
node tests/parsers.test.mjs
```
