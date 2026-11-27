// Background service worker: makes the cross-origin requests content scripts
// can't (Netflix subtitle files, DeepL), keeping the DeepL key out of pages.

const FETCH_ALLOWED = /^https:\/\/([a-z0-9-]+\.)*nflxvideo\.net\//i;

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'dc:fetchText') {
    fetchText(msg.url).then(reply, (e) => reply({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'dc:deepl') {
    deepl(msg).then(reply, (e) => reply({ ok: false, code: 'network', error: `DeepL: ${e.message}` }));
    return true;
  }
});

async function fetchText(url) {
  if (!FETCH_ALLOWED.test(url)) return { ok: false, error: 'URL not allowed' };
  const res = await fetch(url);
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  return { ok: true, text: await res.text() };
}

// DeepL wants upper-case codes and a regional variant for some targets.
const deeplSource = (l) => (l.startsWith('zh') ? 'ZH' : l.toUpperCase());
const deeplTarget = (l) =>
  ({ en: 'EN-US', pt: 'PT-BR', zh: 'ZH-HANS', 'zh-Hant': 'ZH-HANT' })[l] || l.toUpperCase();

async function deepl({ texts, from, to, context }) {
  const { deeplKey = '' } = await chrome.storage.local.get('deeplKey');
  const key = deeplKey.trim();
  if (!key) return { ok: false, code: 'unsupported', error: 'Add your DeepL API key in the popup.' };
  const host = key.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
  const body = { text: texts, target_lang: deeplTarget(to) };
  if (from) body.source_lang = deeplSource(from);
  if (context) body.context = context;
  const res = await fetch(`https://${host}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 403) return { ok: false, code: 'unsupported', error: 'DeepL rejected the API key. Check it in the popup.' };
  if (res.status === 456) return { ok: false, code: 'unsupported', error: 'DeepL monthly quota used up.' };
  if (!res.ok) return { ok: false, code: 'network', error: `DeepL error ${res.status}` };
  const data = await res.json();
  return { ok: true, texts: data.translations.map((t) => t.text) };
}
