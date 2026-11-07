// Maps backend failures to localized text. The backend sends a stable `code`
// (AppError::code in src-tauri/src/error.rs) and an English technical detail. The UI
// shows a localized title and keeps the detail verbatim, isolated as LTR text, because
// it can contain paths, versions and identifiers that must not be translated.
import { en, type Key } from "./en";
import { translate, type Lang } from "./index";

export interface ErrorLike { code: string; message: string }

export function toErrorLike(e: unknown): ErrorLike {
  if (e && typeof e === "object" && "code" in e) {
    const o = e as { code: unknown; message?: unknown };
    return { code: String(o.code), message: String(o.message ?? "") };
  }
  if (e instanceof Error) return { code: "unknown", message: e.message };
  return { code: "unknown", message: String(e ?? "") };
}

export function errorTitleKey(code: string): Key {
  const key = `error.${code}`;
  return (key in en ? key : "error.unknown") as Key;
}

export function describeError(lang: Lang, e: unknown): string {
  const { code, message } = toErrorLike(e);
  const title = translate(lang, errorTitleKey(code));
  const detail = message.trim();
  return detail ? translate(lang, "error.withDetail", { title, detail }) : title;
}
