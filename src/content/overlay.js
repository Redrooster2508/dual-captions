// The caption overlay drawn over the video: the subtitle line (clickable
// words), the translation line, the word popup and small toasts. It lives in a
// shadow root so the site's CSS can't reach it.
(() => {
  const DC = (globalThis.DC ??= {});

  const CSS = `
    :host { all: initial; }
    .wrap {
      position: absolute; inset: 0; pointer-events: none;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans CJK SC", "Noto Sans JP", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .box {
      position: absolute; left: 50%; transform: translateX(-50%);
      max-width: 90%; width: max-content;
      display: flex; flex-direction: column; align-items: center; gap: .2em;
      text-align: center; pointer-events: auto;
    }
    .line {
      background: rgba(10, 10, 12, .74); color: #fff;
      padding: .1em .45em; border-radius: .22em;
      line-height: 1.32; white-space: pre-wrap; overflow-wrap: anywhere;
      text-shadow: 0 1px 2px rgba(0, 0, 0, .55);
    }
    .line:empty { display: none; }
    .primary { font-size: 1em; }
    .secondary { font-size: .74em; color: #f5d68a; transition: filter .15s; }
    .secondary.blur { filter: blur(.3em); }
    .secondary.blur:hover { filter: none; }
    .secondary.note { color: #c9c9cf; font-style: italic; }
    .secondary.action { color: #9fd3ff; cursor: pointer; text-decoration: underline; text-underline-offset: .2em; }

    .w { cursor: pointer; border-radius: .15em; transition: background .1s; }
    .w:hover, .w.picked { background: rgba(255, 255, 255, .22); }
    .w.learning { text-decoration: underline 0.08em #7cc4ff; text-underline-offset: .18em; }
    .w.important { text-decoration: underline 0.08em #ffc24b; text-underline-offset: .18em; color: #ffe3a3; }
    .w.elsewhere { text-decoration: underline dotted 0.08em #9a9cab; text-underline-offset: .18em; }

    .pop {
      position: absolute; bottom: calc(100% + .5em); left: 0;
      font-size: max(13px, .5em); line-height: 1.4; text-align: left;
      width: max-content; min-width: 15em; max-width: 24em;
      background: #1c1d22; color: #ececf1; border: 1px solid #34363e;
      border-radius: .7em; padding: .8em .9em .75em; box-shadow: 0 .6em 2em rgba(0, 0, 0, .45);
    }
    .pop[hidden] { display: none; }
    .pop-head { display: flex; align-items: center; gap: .5em; }
    .pop-word { font-size: 1.45em; font-weight: 650; letter-spacing: -.01em; }
    .pop-lang { display: flex; align-items: center; gap: .4em; color: #8d8f9a; font-size: .85em; margin-top: .1em; }
    .pop-lang select {
      font: inherit; color: #c9cbd4; background: #2a2c33; border: 1px solid #3b3e47; border-radius: .4em;
      padding: .15em .3em; min-width: 0; cursor: pointer;
    }
    .pop-also { color: #a9abb6; font-size: .88em; margin-top: .3em; }
    .pop-also b { color: #d7d9e0; font-weight: 600; }
    .pop-close { margin-left: auto; }
    .pop-tr { margin: .25em 0 .1em; font-size: 1.08em; color: #f5d68a; }
    .pop-tr.dim { color: #8d8f9a; font-style: italic; font-size: .95em; }
    .pop-row { display: flex; flex-wrap: wrap; align-items: center; gap: .4em; margin-top: .7em; }
    button, a.btn {
      font: inherit; font-size: .92em; color: inherit; text-decoration: none;
      background: #2a2c33; border: 1px solid #3b3e47; border-radius: .5em;
      padding: .3em .65em; cursor: pointer; line-height: 1.2;
    }
    button:hover, a.btn:hover { background: #343740; }
    button.icon { padding: .3em .45em; background: transparent; border-color: transparent; }
    button.primary-btn { background: #2f6fde; border-color: #2f6fde; color: #fff; }
    button.primary-btn:hover { background: #3b7cf0; }
    .seg { display: inline-flex; border: 1px solid #3b3e47; border-radius: .5em; overflow: hidden; }
    .seg button { border: 0; border-radius: 0; background: transparent; }
    .seg button + button { border-left: 1px solid #3b3e47; }
    .seg button[aria-pressed="true"] { background: #2f6fde; color: #fff; }
    button.star[aria-pressed="true"] { color: #ffc24b; border-color: #6b5420; background: #2e2716; }
    .pop-links { margin-left: auto; display: flex; gap: .6em; }
    .pop-links a { color: #9fd3ff; font-size: .9em; }
    .pop-saved { color: #8d8f9a; font-size: .85em; margin-top: .55em; }

    .toast {
      position: absolute; top: 5%; left: 50%; transform: translateX(-50%);
      font-size: max(12px, .5em); background: rgba(10, 10, 12, .82); color: #fff;
      padding: .45em .95em; border-radius: 2em; opacity: 0; transition: opacity .2s;
      white-space: nowrap; pointer-events: none;
    }
    .toast.show { opacity: 1; }
  `;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  const segmenters = new Map();
  function segment(text, lang) {
    const key = lang || '';
    if (!segmenters.has(key)) {
      try { segmenters.set(key, new Intl.Segmenter(lang || undefined, { granularity: 'word' })); }
      catch { segmenters.set(key, new Intl.Segmenter(undefined, { granularity: 'word' })); }
    }
    return segmenters.get(key).segment(text);
  }

  class Overlay {
    constructor(handlers) {
      this.h = handlers;
      this.host = document.createElement('dualcap-overlay');
      this.host.style.cssText =
        'all: initial; position: fixed; z-index: 2147483646; pointer-events: none; display: none; left: 0; top: 0; width: 0; height: 0;';
      const root = this.host.attachShadow({ mode: 'open' });
      const style = el('style');
      style.textContent = CSS;
      this.wrap = el('div', 'wrap');
      this.box = el('div', 'box');
      this.primary = el('div', 'line primary');
      this.secondary = el('div', 'line secondary');
      this.pop = el('div', 'pop');
      this.pop.hidden = true;
      this.toastEl = el('div', 'toast');
      this.box.append(this.primary, this.secondary, this.pop);
      this.wrap.append(this.box, this.toastEl);
      root.append(style, this.wrap);

      this.lookup = () => ({});
      this.last = { p: null, s: null, sKind: null, lang: null };
      this.rect = '';

      // Keep clicks on captions from reaching the player (which would toggle play).
      for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
        this.host.addEventListener(type, (e) => e.stopPropagation());
      }
      this.box.addEventListener('mouseenter', () => this.h.onHover?.(true));
      this.box.addEventListener('mouseleave', () => this.h.onHover?.(false));
      this.primary.addEventListener('click', (e) => {
        const w = e.target.closest('.w');
        if (w) this.h.onWordClick?.(w.dataset.word, w);
      });
      this.secondary.addEventListener('click', () => {
        if (this.secondary.classList.contains('action')) this.h.onSecondaryAction?.();
      });
      this.pop.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (b) { e.preventDefault(); this.h.onPopupAction?.(b.dataset.act); }
      });
    }

    get visible() { return this.host.style.display !== 'none'; }

    show(parent) {
      if (this.host.parentNode !== parent) parent.appendChild(this.host);
      if (!this.visible) this.host.style.display = 'block';
    }

    hide() {
      if (this.visible) this.host.style.display = 'none';
    }

    // Line up with the video and size the text to the video's height.
    place(r, bottomInset, scale) {
      const fontPx = Math.round(Math.min(72, Math.max(14, r.height * 0.043 * scale)));
      const key = `${r.left}|${r.top}|${r.width}|${r.height}|${bottomInset}|${fontPx}`;
      if (key === this.rect) return;
      this.rect = key;
      Object.assign(this.host.style, {
        left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
      });
      this.wrap.style.fontSize = `${fontPx}px`;
      this.box.style.bottom = `${Math.round(r.height * 0.07 + bottomInset)}px`;
    }

    // primary: { text, lang }, secondary: { text, kind: 'text'|'note'|'action' }
    setLines(primary, secondary, blur) {
      if (primary.text !== this.last.p || primary.lang !== this.last.lang) {
        this.last.p = primary.text;
        this.last.lang = primary.lang;
        this.renderPrimary(primary.text, primary.lang);
      }
      if (secondary.text !== this.last.s || secondary.kind !== this.last.sKind) {
        this.last.s = secondary.text;
        this.last.sKind = secondary.kind;
        this.secondary.textContent = secondary.text;
        this.secondary.classList.toggle('note', secondary.kind === 'note');
        this.secondary.classList.toggle('action', secondary.kind === 'action');
      }
      this.secondary.classList.toggle('blur', !!blur && secondary.kind === 'text');
    }

    renderPrimary(text, lang) {
      const frag = document.createDocumentFragment();
      for (const { segment: s, isWordLike } of segment(text || '', lang)) {
        if (!isWordLike) { frag.append(s); continue; }
        const span = el('span', 'w', s);
        span.dataset.word = s;
        frag.append(span);
      }
      this.primary.replaceChildren(frag);
      this.lang = lang;
      this.markWords();
    }

    // Highlight words that are in the library. lookup(word, lang) returns
    // { match, others }: the entry for this variety, and ones for other regions.
    setLookup(fn) { this.lookup = fn; this.markWords(); }
    markWords() {
      for (const w of this.primary.querySelectorAll('.w')) {
        const { match, others = [] } = this.lookup(w.dataset.word, this.lang) || {};
        w.classList.toggle('important', !!match?.important);
        w.classList.toggle('learning', !!match && !match.important && match.status === 'learning');
        w.classList.toggle('elsewhere', !match && others.length > 0);
      }
    }

    get lineText() { return this.primary.textContent; }

    // data: { word, langLabel, varieties: { value, options: [[tag, label]] } | null,
    //         translation, trState: 'loading'|'done'|'dim', entry, also: [{ where, translation }],
    //         links: [[label, url]] }
    showPopup(anchor, data) {
      this.primary.querySelectorAll('.picked').forEach((w) => w.classList.remove('picked'));
      anchor?.classList.add('picked');
      this.anchor = anchor;
      this.renderPopup(data);
      this.pop.hidden = false;
      this.positionPopup();
    }

    renderPopup(d) {
      this.popData = d;
      const head = el('div', 'pop-head');
      const speak = el('button', 'icon', '🔊');
      speak.dataset.act = 'speak';
      speak.title = 'Pronounce';
      const close = el('button', 'icon pop-close', '✕');
      close.dataset.act = 'close';
      close.title = 'Close (Esc)';
      head.append(el('span', 'pop-word', d.word), speak, close);

      // "Spanish · [Puerto Rico ▾]": where this video's language is from
      const lang = el('div', 'pop-lang', d.langLabel || '');
      if (d.varieties) {
        const sel = el('select');
        sel.title = "Where this video's language is from. Used for saving, pronunciation and dictionaries.";
        sel.setAttribute('aria-label', 'Region');
        for (const [value, label] of d.varieties.options) sel.append(new Option(label, value, false, value === d.varieties.value));
        sel.addEventListener('change', () => this.h.onPopupAction?.('variety', sel.value));
        lang.append(' · ', sel);
      }

      const tr = el('div', 'pop-tr' + (d.trState === 'done' ? '' : ' dim'), d.translation || '');
      // The same word saved for another region may mean something else.
      const also = (d.also || []).slice(0, 2).map((a) => {
        const line = el('div', 'pop-also', `Saved for ${a.where}`);
        if (a.translation) line.append(': ', el('b', '', a.translation));
        return line;
      });

      const row = el('div', 'pop-row');
      if (!d.entry) {
        const add = el('button', 'primary-btn', '+ Add to library');
        add.dataset.act = 'add';
        const star = el('button', 'star', '★ Important');
        star.dataset.act = 'add-important';
        row.append(add, star);
      } else {
        const seg = el('div', 'seg');
        for (const [status, label] of [['learning', 'Learning'], ['known', 'Learnt']]) {
          const b = el('button', '', label);
          b.dataset.act = `status:${status}`;
          b.setAttribute('aria-pressed', String(d.entry.status === status));
          seg.append(b);
        }
        const star = el('button', 'star', '★');
        star.dataset.act = 'important';
        star.title = d.entry.important ? 'Marked important' : 'Mark important';
        star.setAttribute('aria-pressed', String(!!d.entry.important));
        const del = el('button', 'icon', '🗑');
        del.dataset.act = 'remove';
        del.title = 'Remove from library';
        row.append(seg, star, del);
      }
      const links = el('div', 'pop-links');
      for (const [label, url] of d.links || []) {
        const a = el('a', '', `${label} ↗`);
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        links.append(a);
      }
      row.append(links);

      const parts = [head, lang, tr, ...also, row];
      if (d.entry) parts.push(el('div', 'pop-saved', d.entry.status === 'known' ? 'In your library · learnt' : 'In your library'));
      this.pop.replaceChildren(...parts);
    }

    updatePopup(patch) {
      if (this.pop.hidden || !this.popData) return;
      if (patch.word && patch.word !== this.popData.word) return;
      this.renderPopup({ ...this.popData, ...patch });
      this.positionPopup();
    }

    positionPopup() {
      const box = this.box.getBoundingClientRect();
      const wrap = this.wrap.getBoundingClientRect();
      const a = this.anchor?.isConnected ? this.anchor.getBoundingClientRect() : box;
      const pw = this.pop.offsetWidth;
      let left = a.left + a.width / 2 - pw / 2;
      left = Math.max(wrap.left + 8, Math.min(left, wrap.right - pw - 8));
      this.pop.style.left = `${left - box.left}px`;
    }

    get popupOpen() { return !this.pop.hidden; }

    closePopup() {
      this.pop.hidden = true;
      this.popData = null;
      this.primary.querySelectorAll('.picked').forEach((w) => w.classList.remove('picked'));
    }

    contains(event) { return event.composedPath().includes(this.host); }

    toast(msg) {
      this.toastEl.textContent = msg;
      this.toastEl.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 1800);
    }

    clear() {
      this.closePopup();
      this.setLines({ text: '', lang: '' }, { text: '', kind: 'text' }, false);
    }
  }

  DC.Overlay = Overlay;
})();
