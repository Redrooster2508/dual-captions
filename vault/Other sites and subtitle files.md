---
tags: [site]
---
# Other sites and subtitle files

## Any page with a `<video>`
- Uses the largest `<video>` on the page, rescanned every 1.5 s
- Its `<track kind="subtitles|captions">` elements become tracks. Cues are read by switching a track to `hidden`, which loads it without the browser drawing it; tracks that were showing are hidden while the overlay is active
- Captions lift 44 px when the video has native `controls`
- Top frame only, so videos inside iframes aren't covered
- If a site makes the `<video>` itself fullscreen (instead of its container), the overlay can't be drawn on top

## Dropped subtitle files
Drop `.srt`, `.vtt`, `.ass`, `.ssa`, `.ttml`, `.dfxp` or `.xml` onto the page. This works on YouTube and Netflix too.
- **Format:** from the file extension, otherwise sniffed from the content
- **Which line:** from a language code in the file name (`movie.es.srt`, `show.pt-BR.vtt`). Your language goes on the translation line and the language you're learning on the subtitle line; otherwise it fills the subtitle line if that's empty, else the translation line. The popup can move it
- **Encoding:** UTF-8, UTF-16 by byte-order mark, else a legacy code page guessed from the language (GB18030 for Chinese, Shift JIS for Japanese, Windows-1251 for Russian, …)
- On YouTube and Netflix, dropped files are cleared when you move to another video; on other sites they stay while you're on the page

## Parsers (`parsers.js`)
| Format | Notes |
|---|---|
| WebVTT / SRT | One parser. Cue settings ignored; tags and `{\an8}` stripped; entities decoded |
| ASS / SSA | `[Events]` dialogue lines. Override tags stripped, `\N` → line break, vector drawings skipped, duplicate layers merged |
| TTML / DFXP | Tick, frame and clock times; `<br>` and `<span>`; `begin` offsets from parent elements |
| YouTube json3 | See [[YouTube]] |
