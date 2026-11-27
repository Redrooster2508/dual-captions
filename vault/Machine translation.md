---
tags: [translation]
---
# Machine translation

Used for the translation line only when there's no human track and no YouTube auto-translate (or when "Machine translation" is picked in the popup), and for word lookups.

| Engine | Notes |
|---|---|
| Chrome on-device (default) | The `Translator` API, Chrome 138+ on desktop. Free and private. The first use of a language pair needs a click, because Chrome only downloads a model after one: the translation line becomes a link that says so, then shows download progress |
| DeepL | Your own API key, stored on its own (`deeplKey`) and read only by the background worker. Keys ending `:fx` use `api-free.deepl.com` (500,000 characters a month free). 403 → "rejected the API key", 456 → quota used up |
| Off | Human tracks and YouTube auto-translate only |

No unofficial translation endpoints are used. See [[Decisions]].

## How lines are translated
- Whenever the current line changes, it and the next 12 are queued, so the next line is usually ready before it shows
- DeepL gets up to 30 lines per request; the on-device translator takes 3 at a time
- Results are cached by line text for the current track selection
- Errors show on the translation line. Network errors retry after 15 s; a bad key or an unsupported language pair waits until settings change

## Language codes
Engines get the base language (`es-419` → `es`), except Chinese: `zh` (Simplified) or `zh-Hant`. DeepL targets are `EN-US`, `PT-BR`, `ZH-HANS`, `ZH-HANT`, and otherwise the code in upper case.

## Word lookups
The clicked word is translated on its own. DeepL also gets the caption line as `context`, which helps it pick the right meaning without translating the line.
