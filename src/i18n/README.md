# Localization

Languages: English (default) and Persian (`fa.ts`).

* All UI strings live in `en.ts` (source of truth) and are read through `t("namespace.key")` (see `useI18n.ts`).
* `fa.ts` is typed `Record<Key, string>`, so a key missing from it is a compile error.
* The document layout stays left-to-right in every language. Persian is right-to-left at the text level only (bidi isolates added in `index.ts`).
* Numbers passed as `number` are formatted for the active locale (`en-US` / `fa-IR`); strings are opaque.
* To add a language: create a dictionary next to `en.ts`, extend `Lang`/`LANGS`/`dictionaries`/`isLang` in `index.ts` and add it to the picker in Settings.

Theme (dark default / light) is `appearance.theme`, applied as `data-theme` on `<html>`; tokens are in `src/index.css`.
