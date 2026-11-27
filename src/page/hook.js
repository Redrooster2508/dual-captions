// Runs in the page's own JavaScript world on YouTube and Netflix, before the
// player loads. From here we can see the player objects and the subtitle data
// the player requests, which the isolated content script cannot. We only read
// subtitle text and drive the player (seek/pause); video streams are untouched.
(() => {
  if (window.__dualcapHook) return;
  window.__dualcapHook = true;

  const post = (type, payload) =>
    window.postMessage({ dualcap: 'page', type, payload }, location.origin);
  const handlers = {};
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.dualcap !== 'content') return;
    try { handlers[e.data.type]?.(e.data.payload || {}); } catch (err) { console.warn('[dualcap]', err); }
  });

  // ---------------------------------------------------------------- YouTube
  if (location.hostname.endsWith('youtube.com')) {
    // YouTube's caption URLs need a short-lived token the player adds itself,
    // so we remember the URLs the player requests and reuse their token.
    const seen = new Map(); // url -> true, most recent last
    const onTimedtext = (raw) => {
      let url;
      try { url = new URL(raw, location.href); } catch { return; }
      if (!url.pathname.includes('/api/timedtext')) return;
      seen.delete(url.href);
      seen.set(url.href, true);
      if (seen.size > 40) seen.delete(seen.keys().next().value);
      post('yt:timedtext', { url: url.href });
    };

    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      if (url && String(url).includes('/api/timedtext')) onTimedtext(String(url));
      return origOpen.apply(this, arguments);
    };
    const origFetch = window.fetch;
    window.fetch = function (input) {
      const url = typeof input === 'string' ? input : input?.url || String(input);
      if (url.includes('/api/timedtext')) onTimedtext(url);
      return origFetch.apply(this, arguments);
    };

    const player = () => document.getElementById('movie_player');
    const text = (t) => t?.simpleText ?? t?.runs?.map((r) => r.text).join('') ?? '';

    handlers['yt:getTracks'] = () => {
      const resp = player()?.getPlayerResponse?.();
      const videoId = resp?.videoDetails?.videoId;
      if (!videoId) return;
      const r = resp.captions?.playerCaptionsTracklistRenderer || {};
      post('yt:tracks', {
        videoId,
        title: resp.videoDetails.title || '',
        tracks: (r.captionTracks || []).map((t) => ({
          languageCode: t.languageCode,
          name: text(t.name) || t.languageCode,
          kind: t.kind || '',
          baseUrl: t.baseUrl,
          isTranslatable: !!t.isTranslatable,
        })),
        translationLanguages: (r.translationLanguages || []).map((l) => ({
          languageCode: l.languageCode,
          name: text(l.languageName),
        })),
      });
      for (const url of seen.keys()) post('yt:timedtext', { url });
    };

    // Switching the player's own captions makes it fetch that track (with a
    // fresh token), which onTimedtext then picks up.
    handlers['yt:loadTrack'] = ({ languageCode, kind, reload }) => {
      const p = player();
      if (!p?.setOption) return;
      if (reload) { try { p.unloadModule('captions'); } catch {} }
      try { p.loadModule('captions'); } catch {}
      p.setOption('captions', 'track', kind ? { languageCode, kind } : { languageCode });
    };
  }

  // ---------------------------------------------------------------- Netflix
  if (location.hostname.endsWith('netflix.com')) {
    const WEBVTT = 'webvtt-lssdh-ios8';
    const DFXP = 'dfxp-ls-sdh';
    const manifests = new Map(); // movieId -> tracks

    // Ask for text subtitle formats and every language, not just the few
    // Netflix shows by default for your region.
    const origStringify = JSON.stringify;
    JSON.stringify = function (value) {
      try {
        if (value && typeof value.url === 'string' && /manifest/i.test(value.url)) {
          for (const v of Object.values(value)) {
            if (!v || typeof v !== 'object') continue;
            if (Array.isArray(v.profiles)) {
              for (const p of [DFXP, WEBVTT]) if (!v.profiles.includes(p)) v.profiles.unshift(p);
            }
            if ('showAllSubDubTracks' in v) v.showAllSubDubTracks = true;
          }
        }
      } catch {}
      return origStringify.apply(this, arguments);
    };

    const firstUrl = (d) =>
      d?.urls?.[0]?.url || (d?.downloadUrls && Object.values(d.downloadUrls)[0]) || null;

    const origParse = JSON.parse;
    JSON.parse = function () {
      const value = origParse.apply(this, arguments);
      try {
        const m = value?.result?.timedtexttracks ? value.result : null;
        if (m && m.movieId != null) {
          const tracks = [];
          for (const t of m.timedtexttracks) {
            if (t.isNoneTrack || t.isForcedNarrative) continue;
            const dl = t.ttDownloadables || {};
            let vtt = null, ttml = null;
            for (const [fmt, d] of Object.entries(dl)) {
              if (fmt.startsWith('webvtt')) vtt ||= firstUrl(d);
              else if (fmt.startsWith('dfxp') || fmt.startsWith('imsc')) ttml ||= firstUrl(d);
            }
            if (!vtt && !ttml) continue;
            const cc = t.rawTrackType === 'closedcaptions';
            tracks.push({
              id: t.new_track_id || t.id || `${t.language}-${t.rawTrackType}`,
              lang: t.language,
              label: (t.languageDescription || t.language) + (cc ? ' [CC]' : ''),
              cc,
              vtt,
              ttml,
            });
          }
          manifests.set(String(m.movieId), tracks);
          post('nf:tracks', { movieId: String(m.movieId), tracks });
        }
      } catch {}
      return value;
    };

    handlers['nf:getTracks'] = ({ movieId }) => {
      if (manifests.has(movieId)) post('nf:tracks', { movieId, tracks: manifests.get(movieId) });
    };

    // Setting video.currentTime directly makes Netflix's player error out,
    // so seeking goes through its own player API.
    const nfPlayer = () => {
      try {
        const vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
        const ids = vp.getAllPlayerSessionIds();
        return vp.getVideoPlayerBySessionId(ids.find((id) => id.startsWith('watch')) || ids[ids.length - 1]);
      } catch { return null; }
    };
    handlers['nf:seek'] = ({ ms }) => nfPlayer()?.seek(Math.max(0, Math.round(ms)));
    handlers['nf:pause'] = () => { const p = nfPlayer(); p ? p.pause() : document.querySelector('video')?.pause(); };
    handlers['nf:play'] = () => { const p = nfPlayer(); p ? p.play() : document.querySelector('video')?.play(); };
  }
})();
