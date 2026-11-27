---
tags: [todo]
---
# Known issues and next steps

## Open
- [ ] **Check on real YouTube:** a video with subtitles in several languages. Both lines should appear within about 10 s; also check auto-translate, auto-generated captions and ads. See [[YouTube]]
- [ ] **Check on real Netflix:** both lines, the next episode (preloaded manifest), A / R / D seeking, and captions clearing the controls. See [[Netflix]]
- [ ] **Check Chrome's on-device translator** (Chrome 138+): the first-use click, download progress, a language pair it doesn't support. See [[Machine translation]]
- [ ] **Check regional varieties on real sites:**
  - which tags Netflix uses for Spanish and Portuguese tracks
  - whether YouTube offers `pt-PT` / `en-GB` in auto-translate
  - DeepL `ES-419` and `PT-PT` with a real key
  - which voices your system has for Spain, Mexico and US Spanish
  - that the RAE link opens

  See [[Regional varieties]]
- [ ] Move the browser test scripts into `tests/e2e/`, with the fixtures and a command to generate the test video. They exist only in a session scratchpad. See [[Testing]]
- [ ] No licence file yet. Until there is one, nobody else may legally reuse the code
- [ ] YouTube and Netflix can change their players at any time; `hook.js` and `sites.js` are where it will break
- [ ] YouTube's own captions stay switched on after the extension turns them on (they show again if the extension is turned off)
- [ ] Videos in iframes aren't covered, nor sites that make the `<video>` itself fullscreen

## Ideas
- Transcript panel listing every line; click one to jump to it
- Spaced repetition in review (due dates instead of least recently reviewed)
- Anki deck export with the audio of each saved line
- Timing offset for dropped subtitle files that are out of sync
- Firefox version
- Remember a YouTube channel's region, not only each video's (a Puerto Rican creator's videos are all Puerto Rican Spanish)
- Script variants beyond Chinese: Serbian in Cyrillic or Latin
- YouTube Shorts and embedded YouTube players
- Join auto-generated YouTube fragments into whole sentences before translating
