---
tags: [log]
---
# Changelog

Newest first. Commit ids link the change to the repository history. The narrative is in [[Log/2026-11-27]].

## 2026-11-27 · Regional varieties, 0.2.0 (`d7b879f`)
- Choose a region for "I'm learning" and "I speak": Spain, Mexico, Puerto Rico and nine more for Spanish; Brazil and Portugal; US, UK, Australia…; Canada and France; Simplified and Traditional Chinese; Arabic by country. See [[Regional varieties]]
- Subtitles, YouTube auto-translate and DeepL (`EN-GB`, `PT-PT`, `ES-419`, `ZH-HANT`…) use the closest variety; the popup says when an engine can't produce yours
- Each video's region: from the track's tag, or set in the word popup or toolbar popup, and remembered
- [[Library]]: words saved per region, the region shown and changeable on each card, filter and search by region, `variety` CSV column, region in the add form. Words saved for another region get a dotted underline, and the popup shows that meaning
- Pronunciation uses the closest installed accent; Spanish words link to the RAE or the *Diccionario de americanismos*, Portuguese words to Priberam
- Old language codes sites use (`iw` for Hebrew, `fil`, `no`…) now match

## 2026-11-27 · Project notes and the why
- README: "Why I built this"
- This vault

## 2026-11-27 · First version, 0.1.0 (`943a021`)
- Two caption lines over the video on YouTube, Netflix and any page with an HTML5 video
- Translation line from a human track, YouTube auto-translate, or machine translation (Chrome on-device or DeepL)
- Click a word: meaning, pronunciation, dictionary link, add to the library
- [[Library]]: Learning / Learnt / ★ Important, notes, the sentence and a link back to that moment; search, filters, flashcard review, CSV and JSON export, restore, add by hand
- Shortcuts A / R / D / Q / W, pause on hover, drop in .srt / .vtt / .ass / .ttml files
- Toolbar popup for languages, tracks, display and translation settings
