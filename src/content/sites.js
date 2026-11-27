// Site adapters. Each one finds the video, works out which title is playing,
// discovers its subtitle tracks and knows how to seek/pause on that site.
//
// A track is { id, label, lang, rank, auto, load(): Promise<cues> }. When
// picking a default, human tracks come before auto-generated ones (auto),
// then the closest language variety, then lower rank.
(() => {
  const DC = (globalThis.DC ??= {});

  // Messages to and from src/page/hook.js, which runs in the page's own world.
  const toPage = (type, payload) => window.postMessage({ dualcap: 'content', type, payload }, location.origin);
  const pageListeners = new Map();
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.dualcap !== 'page') return;
    for (const fn of pageListeners.get(e.data.type) || []) fn(e.data.payload || {});
  });
  const onPage = (type, fn) => {
    if (!pageListeners.has(type)) pageListeners.set(type, new Set());
    pageListeners.get(type).add(fn);
  };

  function largestVideo(root = document) {
    let best = null, bestArea = 0;
    for (const v of root.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      if (r.width * r.height > bestArea) { best = v; bestArea = r.width * r.height; }
    }
    return best;
  }

  const nativeSeek = (video, t) => { video.currentTime = Math.max(0, t); };

  // ---------------------------------------------------------------- YouTube
  function youtube(ctrl) {
    const urls = new Map(); // videoId -> Map("lang|kind" -> timedtext URL with token)
    const waiters = new Set();
    let key = null;
    let title = '';

    // videoId -> { byTrack: Map("lang|kind" -> url), withToken: latest url carrying a token }
    onPage('yt:timedtext', ({ url }) => {
      const u = new URL(url);
      const v = u.searchParams.get('v');
      if (!v) return;
      if (!urls.has(v)) urls.set(v, { byTrack: new Map(), withToken: null });
      const known = urls.get(v);
      known.byTrack.set(`${u.searchParams.get('lang')}|${u.searchParams.get('kind') || ''}`, u.href);
      if (u.searchParams.has('pot')) known.withToken = u.href;
      for (const w of waiters) if (w.v === v) { waiters.delete(w); w.resolve(); }
    });

    const waitForUrl = (v, ms) => new Promise((resolve) => {
      const w = { v, resolve };
      waiters.add(w);
      setTimeout(() => { waiters.delete(w); resolve(); }, ms);
    });

    // Build a caption URL for this track. YouTube only answers requests that
    // carry the player's token ("pot"), so borrow it from the latest caption
    // request the player made for this video. Requests the player sent before
    // it had a token are only used if nothing better is known.
    function tokenUrl(t, tlang) {
      const known = urls.get(t.videoId);
      if (!known) return null;
      const exact = known.byTrack.get(`${t.languageCode}|${t.kind}`);
      const donor = known.withToken;
      let u;
      if (exact && (new URL(exact).searchParams.has('pot') || !donor)) {
        u = new URL(exact);
      } else if (donor) {
        u = new URL(t.baseUrl, location.href);
        for (const [k, val] of new URL(donor).searchParams) {
          if (!u.searchParams.has(k) && !['lang', 'kind', 'name', 'tlang', 'fmt'].includes(k)) u.searchParams.set(k, val);
        }
      } else return null;
      u.searchParams.set('fmt', 'json3');
      if (tlang) u.searchParams.set('tlang', tlang); else u.searchParams.delete('tlang');
      return u.href;
    }

    async function fetchCues(t, tlang) {
      const tried = new Set();
      const attempt = async (url) => {
        if (!url || tried.has(url)) return null;
        tried.add(url);
        const res = await fetch(url, { credentials: 'include' });
        const text = res.ok ? await res.text() : '';
        return text.trim() ? DC.parse.json3(text) : null;
      };
      let cues = await attempt(tokenUrl(t, tlang));
      // Switching the player to this track makes it request it, with a fresh
      // token once it has one. Right after the page loads it doesn't have one
      // yet, so back off and ask again.
      for (const delay of [0, 1500, 3000, 6000]) {
        if (cues) break;
        if (delay) await new Promise((r) => setTimeout(r, delay));
        toPage('yt:loadTrack', { languageCode: t.languageCode, kind: t.kind, reload: delay > 0 });
        await waitForUrl(t.videoId, 4000);
        cues = await attempt(tokenUrl(t, tlang));
      }
      if (!cues) {
        const plain = new URL(t.baseUrl, location.href);
        plain.searchParams.set('fmt', 'json3');
        if (tlang) plain.searchParams.set('tlang', tlang);
        cues = await attempt(plain.href);
      }
      if (!cues) throw new Error("YouTube didn't send these captions. Press C twice on the video, then pick the track again.");
      return cues;
    }

    onPage('yt:tracks', (p) => {
      if (!key || p.videoId !== key || ctrl.tracksKnown(key)) return;
      title = p.title;
      const translations = p.translationLanguages || [];
      const tracks = p.tracks.map((t) => {
        const raw = { ...t, videoId: p.videoId };
        return {
          id: `yt:${t.languageCode}:${t.kind}`,
          label: t.name,
          lang: t.languageCode,
          rank: t.kind === 'asr' ? 1 : 0,
          auto: t.kind === 'asr',
          raw,
          load: () => fetchCues(raw),
        };
      });
      // YouTube can machine-translate any translatable track into many languages.
      const translationFor = (track, target) => {
        if (!track.raw?.isTranslatable) return null;
        const tl = translations
          .map((l) => ({ l, fit: DC.langFit(l.languageCode, target) }))
          .filter((x) => x.fit > 0)
          .sort((a, b) => b.fit - a.fit)[0]?.l;
        if (!tl) return null;
        return {
          id: `yt-tl:${track.id}:${tl.languageCode}`,
          label: `${tl.name || tl.languageCode} (YouTube auto-translate)`,
          lang: tl.languageCode,
          rank: 2,
          auto: true,
          load: () => fetchCues(track.raw, tl.languageCode),
        };
      };
      ctrl.setTracks(key, tracks, { translationFor });
    });

    return {
      name: 'YouTube',
      nativeClass: 'dualcap-hide-yt',
      mediaKey: () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null),
      findVideo: () => document.querySelector('#movie_player video.html5-main-video') || document.querySelector('#movie_player video'),
      isAd: () => !!document.querySelector('#movie_player.ad-showing'),
      bottomInset: () => (document.querySelector('#movie_player:not(.ytp-autohide)') ? 52 : 0),
      title: () => title || document.title.replace(/ - YouTube$/, ''),
      shareUrl: (t) => `https://www.youtube.com/watch?v=${key}&t=${Math.floor(t)}s`,
      seek: nativeSeek,
      pause: (v) => v.pause(),
      play: (v) => v.play(),
      onMediaChange(k) {
        key = k;
        title = '';
        if (!k) return;
        let tries = 0;
        const ask = () => {
          if (key !== k || ctrl.tracksKnown(k)) return;
          if (++tries > 24) { ctrl.setTracks(k, []); return; }
          toPage('yt:getTracks');
          setTimeout(ask, 750);
        };
        ask();
      },
    };
  }

  // ---------------------------------------------------------------- Netflix
  function netflix(ctrl) {
    const manifests = new Map();
    let key = null;
    let title = '';

    const publish = () => {
      const tracks = manifests.get(key);
      if (!tracks || ctrl.tracksKnown(key)) return;
      ctrl.setTracks(key, tracks.map((t) => ({
        id: `nf:${t.id}`,
        label: t.label,
        lang: t.lang,
        rank: t.cc ? 1 : 0,
        async load() {
          const res = await chrome.runtime.sendMessage({ type: 'dc:fetchText', url: t.vtt || t.ttml });
          if (!res?.ok) throw new Error(`Couldn't download Netflix subtitles (${res?.error || 'no response'})`);
          return t.vtt ? DC.parse.vtt(res.text) : DC.parse.ttml(res.text);
        },
      })));
    };
    onPage('nf:tracks', ({ movieId, tracks }) => {
      manifests.set(movieId, tracks);
      if (movieId === key) publish();
    });

    return {
      name: 'Netflix',
      nativeClass: 'dualcap-hide-nf',
      mediaKey: () => /^\/watch\/(\d+)/.exec(location.pathname)?.[1] || null,
      findVideo: () => largestVideo(document.querySelector('.watch-video') || document),
      // Netflix's controls take more room than YouTube's; lift captions while they show.
      bottomInset: (v, r) => (document.querySelector('[data-uia="controls-standard"]') ? r.height * 0.09 : 0),
      title: () => {
        const t = document.querySelector('[data-uia="video-title"]')?.innerText?.replace(/\s+/g, ' ').trim();
        if (t) title = t;
        return title || 'Netflix';
      },
      shareUrl: (t) => `https://www.netflix.com/watch/${key}?t=${Math.floor(t)}`,
      seek: (v, t) => toPage('nf:seek', { ms: t * 1000 }),
      pause: () => toPage('nf:pause'),
      play: () => toPage('nf:play'),
      onMediaChange(k) {
        key = k;
        if (!k) return;
        publish();
        toPage('nf:getTracks', { movieId: k });
        setTimeout(() => {
          if (key === k && !ctrl.tracksKnown(k)) ctrl.setStatus('No subtitle list from Netflix yet. If this stays, reload the page.');
        }, 10000);
      },
    };
  }

  // --------------------------------------------------- any page with <video>
  function generic(ctrl) {
    let video = null;
    let key = null;
    let signature = '';
    const hidden = new Set(); // native tracks we switched from showing to hidden

    const trackCues = (tt) => new Promise((resolve, reject) => {
      if (tt.mode === 'disabled') tt.mode = 'hidden';
      let tries = 0;
      const check = () => {
        if (tt.cues?.length) {
          resolve(Array.from(tt.cues, (c) => ({ start: c.startTime, end: c.endTime, text: DC.parse.cleanText(c.text || '') }))
            .filter((c) => c.text));
        } else if (++tries > 40) reject(new Error('This subtitle track has no lines'));
        else setTimeout(check, 250);
      };
      check();
    });

    function scan() {
      video = largestVideo();
      if (!video || !key) return;
      const list = Array.from(video.textTracks).filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
      const sig = list.map((t) => `${t.language}|${t.label}`).join(',');
      if (sig === signature && ctrl.tracksKnown(key)) return;
      signature = sig;
      ctrl.setTracks(key, list.map((tt, i) => ({
        id: `html:${i}:${tt.language}`,
        label: tt.label || DC.langName(tt.language) || `Track ${i + 1}`,
        lang: tt.language,
        rank: 0,
        textTrack: tt,
        load: () => trackCues(tt),
      })), { replace: true });
    }
    setInterval(scan, 1500);

    return {
      name: location.hostname.replace(/^www\./, ''),
      mediaKey: () => location.origin + location.pathname + location.search,
      findVideo: () => (video?.isConnected ? video : (scan(), video)),
      // Stay above the browser's own control bar.
      bottomInset: (v) => (v.controls ? 44 : 0),
      title: () => document.title || location.hostname,
      shareUrl: () => location.href,
      seek: nativeSeek,
      pause: (v) => v.pause(),
      play: (v) => v.play(),
      setNativeHidden(on) {
        if (!video) return;
        if (on) {
          for (const tt of video.textTracks) if (tt.mode === 'showing') { tt.mode = 'hidden'; hidden.add(tt); }
        } else {
          for (const tt of hidden) tt.mode = 'showing';
          hidden.clear();
        }
      },
      onMediaChange(k) { key = k; signature = ''; scan(); },
    };
  }

  DC.sites = {
    create(ctrl) {
      const h = location.hostname;
      if (h === 'www.youtube.com') return youtube(ctrl);
      if (h === 'www.netflix.com') return netflix(ctrl);
      return generic(ctrl);
    },
  };
})();
