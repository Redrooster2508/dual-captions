// Default settings, shared by the content script and the popup. Saved values
// live in chrome.storage.local under "settings" (the DeepL key is stored on
// its own under "deeplKey" and only read by the background worker).
(() => {
  const DC = (globalThis.DC ??= {});
  const ui = (chrome.i18n.getUILanguage() || 'en').split('-')[0].toLowerCase();
  DC.DEFAULTS = {
    enabled: true,
    learnLang: ui === 'es' ? 'en' : 'es', // the language you're learning
    nativeLang: ui, // the language translations are shown in
    engine: 'builtin', // 'builtin' | 'deepl' | 'none'
    fontScale: 1,
    blur: false,
    autoPause: false,
    pauseOnHover: true,
  };
  DC.LANGS = [
    'ar', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fa', 'fi', 'fr', 'he', 'hi', 'hr', 'hu',
    'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv',
    'sw', 'ta', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'zh', 'zh-Hant',
  ];
})();
