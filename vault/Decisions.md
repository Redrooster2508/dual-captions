---
tags: [decisions]
---
# Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-11-27 | **Free, no account, data stays in the browser** | The reason for the project: existing services' paywalls felt like a big restriction ([[Home]]) |
| 2026-11-27 | **Chrome extension** (Manifest V3), not a website | Only an extension can read the subtitle data inside YouTube's and Netflix's players and draw over the video |
| 2026-11-27 | **Chromium browsers only** for now | Firefox needs a different background setup and has no built-in translator API |
| 2026-11-27 | **No build step** | Load unpacked and go; nothing to install |
| 2026-11-27 | Overlay in a **shadow root**, `position: fixed` over the video | Site CSS can't break it, and it works on any page without changing the site's layout |
| 2026-11-27 | YouTube: **reuse the player's own token** | The player already makes valid requests; making tokens would mean imitating YouTube's anti-bot system. See [[YouTube]] |
| 2026-11-27 | Netflix: **seek through its player API** | Setting `currentTime` breaks Netflix playback. See [[Netflix]] |
| 2026-11-27 | Translation line prefers **human tracks**, then YouTube auto-translate, then machine translation | Human subtitles are best for learning, and machine translation costs requests |
| 2026-11-27 | **Chrome on-device translation by default**, DeepL optional with your own key | Free and private by default; no unofficial translation endpoints. See [[Machine translation]] |
| 2026-11-27 | Library in **`chrome.storage.local`**, one entry per language + word | No server or account |
| 2026-11-27 | **Learning / Learnt** status plus a separate **★ Important** flag | The user asked to store words "learnt or important"; importance doesn't depend on progress. See [[Library]] |
| 2026-11-27 | Export **CSV and JSON** | CSV opens in Anki and spreadsheets; JSON is a full backup that can be restored |
| 2026-11-27 | Shortcuts by **physical key** | Learners often have another keyboard layout switched on |
| 2026-11-27 | **No real-YouTube browser test** by disguising the automated browser | Getting past YouTube's bot detection isn't acceptable; simulated pages test the extension's own logic instead. See [[Testing]] |
