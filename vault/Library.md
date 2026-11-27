---
tags: [library]
---
# Library

The words saved while watching: requested as a library to "store words learnt or important" ([[Log/2026-11-27]]).

## Storage
`chrome.storage.local` under `library`: an object keyed by `<language tag in lower case>|<word in lower case>`. The tag includes the region when it's known (`es-pr|guagua`), so a word is one entry per variety: *guagua* for Puerto Rico (bus) and for Chile (baby) are separate words. See [[Regional varieties]]. `src/shared/library.js` is the only code that writes it.

| Field | |
|---|---|
| `word`, `lang` | The word is lower-cased when saved, except in German (nouns are capitalised). `lang` is the line's variety when known (`es-PR`), else the plain language (`es`). Words saved before regions existed are plain |
| `translation`, `note` | Editable on the Library page |
| `status` | `learning` or `known` (shown as "Learnt") |
| `important` | ★, independent of status |
| `sentence`, `sentenceTranslation` | The two caption lines when the word was saved. Saving it again keeps the first sentence |
| `source` | `{ site, title, url, time }`. `url` reopens that moment: YouTube `&t=<s>s`, Netflix `?t=<s>` |
| `addedAt`, `updatedAt`, `reviewedAt` | Timestamps in ms |

## In the captions
- Saved words are underlined: blue while learning, gold (with tinted text) when important. Learnt words aren't marked. A dotted grey underline means the word is saved only for another region
- An entry with no region counts for any line; an entry for another region doesn't
- Word popup: the language with a region picker for this video, then add, or add as important. Once a word is saved: switch Learning / Learnt, toggle ★, remove. Entries for other regions show as "Saved for Spain: …"

## Library page (`src/library/`)
- Tabs for All, Learning, Learnt and ★ Important, with counts. Search covers words, meanings, notes, sentences, titles and region names. A language filter appears when there's more than one language or region: a language on its own, or "All Spanish" plus each region. Sort by newest, oldest, A → Z, or least recently reviewed
- Each card's language chip ("Spanish · Puerto Rico ▾") changes the word's region. It refuses if the word is already saved for that region
- Meanings and notes edit in place; Enter saves. The list doesn't redraw while you're typing in it
- **Review:** flashcards from what's on screen (on "All", only words still being learnt), important first, then least recently reviewed, at most 30. Space shows the meaning; 1 = still learning, 2 = got it (marks it learnt). Every answer stamps `reviewedAt`
- **Export:** CSV of what's on screen (UTF-8 with a byte-order mark so Excel keeps accents; columns word, translation, language, variety, status, important, note, sentence, sentence_translation, source, link, added), or a JSON backup of everything
- **Restore** merges a backup: new words are added; existing ones are replaced only if the backup's copy is newer
- **+ Add word** for words met somewhere else, with a language and region (starting at the variety you're learning)

Ideas for later are in [[Known issues and next steps]].
