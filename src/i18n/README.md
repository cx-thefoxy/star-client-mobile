# Localization

Star Client is English-only. Persian support was removed.

* All UI strings live in `en.ts` and are read through `t("namespace.key")` (see `useI18n.ts`).
* The document is always left-to-right.
* Numbers passed as `number` are formatted for the `en-US` locale; strings are treated as opaque values.
* To add a language later: create a new dictionary next to `en.ts`, extend `Lang`/`LANGS` in `index.ts`, and add a picker back in Settings.
