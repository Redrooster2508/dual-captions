// Machine translation for lines (and single words) that have no human
// translation track. Two engines:
//   builtin - Chrome's on-device Translator API (Chrome 138+, free, private)
//   deepl   - DeepL API with your own key (requests go through background.js)
(() => {
  const DC = (globalThis.DC ??= {});

  const names = DC.namer(['en']);
  const langName = (tag) => names.full(tag);

  // What each engine can produce for a target variety. Chrome's translator
  // takes plain languages (plus Traditional Chinese); DeepL has a few
  // regional variants (British English, European Portuguese, Latin American
  // Spanish…), and background.js picks the closest one.
  function outputLang(tag, engine) {
    const base = DC.baseOf(tag);
    if (engine === 'deepl') return DC.normTag(DC.deeplTarget(tag));
    return base === 'zh' && DC.sameGroup(tag, 'zh-Hant') ? 'zh-Hant' : base;
  }

  const fail = (code, message) => Object.assign(new Error(message), { code });

  let builtin = null; // { key, promise }
  let progress = null; // fraction downloaded while the model is fetched

  function getBuiltin(from, to) {
    const key = `${from}>${to}`;
    if (builtin?.key === key) return builtin.promise;
    const promise = (async () => {
      if (typeof self.Translator === 'undefined') {
        throw fail('unsupported', 'On-device translation needs Chrome 138+ on desktop. Choose DeepL in the popup instead.');
      }
      const avail = await Translator.availability({ sourceLanguage: from, targetLanguage: to });
      if (avail === 'unavailable') throw fail('unsupported', `Chrome can't translate ${langName(from)} → ${langName(to)} on this device.`);
      // Downloading a language model needs a click from you first.
      if (avail !== 'available' && !navigator.userActivation?.isActive) {
        throw fail('gesture', `Click here to download ${langName(from)} → ${langName(to)} translation (one time)`);
      }
      return Translator.create({
        sourceLanguage: from,
        targetLanguage: to,
        monitor(m) { m.addEventListener('downloadprogress', (e) => { progress = e.loaded; }); },
      });
    })();
    builtin = { key, promise };
    promise.catch(() => { if (builtin?.promise === promise) builtin = null; });
    return promise;
  }

  // Translate several texts; resolves to an array in the same order.
  async function many(texts, from, to, engine, context) {
    if (!texts.length) return [];
    if (DC.baseOf(from) && DC.baseOf(from) === DC.baseOf(to)) return texts.slice();
    if (engine === 'builtin') {
      if (!DC.baseOf(from)) throw fail('unsupported', 'Set "I\'m learning" in the popup so the subtitle language is known.');
      const tr = await getBuiltin(outputLang(from, engine), outputLang(to, engine));
      const out = [];
      for (const t of texts) out.push(await tr.translate(t));
      return out;
    }
    if (engine === 'deepl') {
      const res = await chrome.runtime.sendMessage({ type: 'dc:deepl', texts, from: DC.baseOf(from), to: DC.normTag(to), context });
      if (!res?.ok) throw fail(res?.code || 'network', res?.error || 'DeepL request failed');
      return res.texts;
    }
    throw fail('off', 'Machine translation is off');
  }

  DC.langName = langName;
  DC.translate = {
    many,
    outputLang,
    downloadProgress: () => progress,
    reset() { builtin = null; progress = null; },
  };
})();
