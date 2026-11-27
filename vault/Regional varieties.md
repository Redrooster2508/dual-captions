---
tags: [languages]
---
# Regional varieties

Requested 2026-11-27: "languages have different words eg spanish in europe vs mexican vs pr spanish is different make sure this and other languages are accounted for" ([[Log/2026-11-27]]). A *guagua* is a bus in Puerto Rico and a baby in Chile, so the region matters for subtitles, translations, pronunciation, dictionaries and saved words.

## The model
Every language setting and library entry is a BCP 47 tag. A region (for Chinese, a script) makes it a variety: `es-PR`, `pt-PT`, `zh-Hant`. Valencian Catalan has its own registered variant subtag (`ca-ES-valencia`, kept as `ca-valencia`). Only variants listed in `DC.VARIETIES` count, so `en-GB-oxendict` is just `en-GB`. A bare tag (`es`) means any variety, or not known. Old codes that sites still use are mapped: `iw` → `he` (YouTube's Hebrew), `in` → `id`, `fil` → `tl`, `no` → `nb`, `ji` → `yi`, `jw` → `jv`, `mo` → `ro`. So are codes that name a variety: `prs` (Dari) → `fa-AF`, `pes` → `fa-IR`.

`DC.VARIETIES` in `src/shared/settings.js` lists, per language, the regions offered in the popup, groups of regions that use the language in similar ways, and the nearest neighbours of some regions.

| Language | Offered | Groups |
|---|---|---|
| Spanish | Spain, Mexico, United States, Puerto Rico, Cuba, Dominican Republic, Colombia, Venezuela, Peru, Chile, Argentina, Latin America (`es-419`) | Spain · the Americas (including the US) |
| Portuguese | Brazil, Portugal, Angola, Mozambique | Brazil · Portugal, Africa and Timor |
| English | US, UK, Canada, Australia, New Zealand, Ireland, India, South Africa | US and Canada · UK and the Commonwealth |
| French | France, Canada, Belgium, Switzerland | Canada · Europe |
| German | Germany, Austria, Switzerland | one group |
| Dutch | Netherlands, Belgium | Netherlands and Suriname · Belgium |
| Chinese | Simplified, Traditional, Hong Kong | Simplified (CN, SG, MY) · Traditional (TW, HK, MO) |
| Arabic | Egypt, Saudi Arabia, UAE, Lebanon, Syria, Jordan, Palestine, Iraq, Morocco, Algeria, Tunisia | Egypt and Sudan · Gulf · Levant · Iraq · Maghreb |
| Catalan | Catalonia (`ca-ES`), Valencia (`ca-ES-valencia`), Andorra | one group. `ca-ES` is labelled Catalonia because Valencian has its own tag |
| Persian | Iran, Afghanistan (Dari) | each its own group |

Neighbours, closest first: Puerto Rico → Dominican Republic, Cuba, Venezuela, US. Mexico ↔ US. Valencia → Catalonia. Argentina → Uruguay, Paraguay. Australia → New Zealand, UK. Hong Kong → Macau, Traditional. And a few more.

## Matching
`DC.langFit(have, want)` scores how well a track, voice or translation in `have` suits someone who wants `want`:

| Score | When | Example, wanting `es-PR` |
|---|---|---|
| 100 | Same tag | `es-PR` |
| 90, 89… | A neighbour, in order | `es-DO`, then `es-CU` |
| 70 | Same group | `es-419`, `es-MX` |
| 60 | No region wanted: any variety will do | |
| 50 | Plain tag | `es` |
| 20 | Another region | `es-ES` |
| 0 | Another language | `pt-BR` |

Regions that aren't offered still match by group, so an `es-GT` track suits a Mexican Spanish learner.

## Where it's used
- **Subtitle line:** the best track for "I'm learning". Human tracks come before auto-generated ones, then the score decides, then the site's order. Same-language captions of one video transcribe the same audio, so a better-fitting tag on an auto-generated track doesn't make it the better choice.
- **Translation line:** the human track closest to "I speak". If there isn't one, YouTube auto-translate into the closest of its `translationLanguages` (for example `pt-PT`). If that isn't available either, machine translation.
- **Machine translation:**
  - DeepL gets the closest variant it has:
    - English: `EN-GB` (UK and the Commonwealth) or `EN-US`
    - Portuguese: `PT-PT` or `PT-BR`
    - Spanish: `ES-419` (the Americas) or `ES`
    - Chinese: `ZH-HANT` or `ZH-HANS`
    - other languages: the plain language
  - DeepL's Latin American Spanish is a neutral variety, not one per country.
  - Chrome's on-device translator gets plain languages, plus `zh-Hant` for Traditional Chinese.
  - When the result isn't your exact variety, the popup says what you get instead (see [[Machine translation]]).
- **The line's own variety:**
  - In order: what you set for this video, then the subtitle track's tag, then unknown. It is never assumed from your settings, because what you watch isn't always the region you're learning.
  - Set it in the word popup's region picker or in the toolbar popup ("Where this Spanish is from").
  - It's remembered per video in `chrome.storage.local` under `varieties` (`{ "<site>|<media key>": tag }`, keeping the 300 most recent).
- **Library:**
  - Words are saved per variety ([[Library]]).
  - An entry with no region matches any line. An entry for another region doesn't: that word gets a dotted grey underline in the captions, and the popup shows "Saved for Spain: …" next to the option to save it for this region.
- **Pronunciation:** the installed voice with the best score for the line's variety, or for the variety you're learning when the line's is unknown. Puerto Rico falls back to Dominican, Cuban or Venezuelan voices, then US Spanish; Angola falls back to Portugal.
- **Dictionaries:**
  - Wiktionary always; it labels regional senses.
  - Spanish also links the ASALE's *Diccionario de americanismos* (`asale.org/damer/<word>`) for the Americas, which lists meanings by country, and the RAE's DLE (`dle.rae.es/<word>`) otherwise.
  - Portuguese also links Priberam, which marks Brazilian usage.

## Defaults
"I speak" starts at the browser's own language and region when one is offered, or the nearest offered one: `en-GB` → English (UK), `zh-CN` → Simplified Chinese, `es-GT` → Latin America.

## Not covered
- Script variants other than Chinese (for example Serbian in Cyrillic or Latin)
- Balearic Catalan (Mallorca's *al·lot* for "boy"): there's no standard tag for it
- Dialects within one country: Irish (Munster, Connacht, Ulster), north and south Welsh, Galician and Basque dialects. These languages are in the list without regions
- Regional slang in meanings: the meaning comes from the translation engine, so the dictionaries are the better reference
- The region is remembered per video, not per YouTube channel (see [[Known issues and next steps]])
