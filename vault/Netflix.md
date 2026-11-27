---
tags: [site]
---
# Netflix

## Subtitle list from the manifest
Netflix fetches a "manifest" for each title. The request body is built with `JSON.stringify` before it's encrypted, and the response is read with `JSON.parse`, so `hook.js` wraps both (from document start, in the page's own JavaScript):
- **Request:** objects whose `url` matches `/manifest/i` get `webvtt-lssdh-ios8` and `dfxp-ls-sdh` added to `profiles` (text subtitle formats) and `showAllSubDubTracks = true` (every language, not just the few shown for your region)
- **Response:** `result.timedtexttracks` (with `result.movieId`). Each track gives a language, a label (`[CC]` for closed captions) and a WebVTT or TTML URL from `ttDownloadables`. Newer manifests use `urls[0].url` and older ones `downloadUrls{}`; both are handled. The "off" track, forced narratives and image-only subtitles are skipped

Manifests are kept per `movieId`, so a preloaded next episode works; the content script matches it to `/watch/<id>`.

## Downloading
The files are on `*.nflxvideo.net`. The content script asks the background worker (`dc:fetchText`), which only fetches from that domain.

## Seeking
Setting `video.currentTime` makes Netflix's player error, so seek, pause and play go through `netflix.appContext.state.playerApp.getAPI().videoPlayer.getVideoPlayerBySessionId(<watch session>)`.

## Other
- Netflix's own subtitles (`.player-timedtext`) are hidden while the overlay is active
- Captions lift by 9% of the video height while `[data-uia="controls-standard"]` exists, assumed to mean the controls are showing (unverified)
- The title comes from `[data-uia="video-title"]` when it's on screen
- If the extension was installed after the tab was opened, the hook missed the manifest; after 10 s the popup says to reload
- **Not yet checked on a real Netflix account.** See [[Testing]]
