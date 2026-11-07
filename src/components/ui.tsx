import { useEffect, useId, useRef, useState, cloneElement, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactElement, type ReactNode, type RefObject } from "react";
import { X } from "./icons";
import { useI18n } from "../i18n/useI18n";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog behavior shared by every modal: focus moves in on open and returns to the
 * trigger on close, Tab cycles inside the dialog, and Escape dismisses it.
 */
export function useDialog(ref: RefObject<HTMLElement>, onClose: () => void, enabled = true) {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const items = () => (node ? [...node.querySelectorAll<HTMLElement>(FOCUSABLE)] : []);
    const first = items()[0] ?? node;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); latest.current(); return; }
      if (e.key !== "Tab") return;
      const f = items();
      if (f.length === 0) { e.preventDefault(); return; }
      const head = f[0], tail = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === head || !node?.contains(document.activeElement))) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [enabled]);
}

/** Exit animation for full-screen layers: `leave()` adds the `is-leaving` class, then calls `onGone` after the animation (instantly with reduced motion). */
export const LAYER_EXIT_MS = 160;
export function useLayerExit(onGone: () => void) {
  const [leaving, setLeaving] = useState(false);
  const latest = useRef(onGone);
  latest.current = onGone;
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const leave = () => {
    if (timer.current !== null) return;
    const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) { latest.current(); return; }
    setLeaving(true);
    timer.current = window.setTimeout(() => latest.current(), LAYER_EXIT_MS);
  };
  return { leaving, leave };
}

export function Pill({ children, active, tone }: { children: ReactNode; active?: boolean; tone?: "danger" }) {
  const cls = tone === "danger"
    ? "border-danger/40 bg-danger/10 text-danger"
    : active ? "border-accent/40 bg-accent/10 text-accent" : "border-line bg-raised text-ink-muted";
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5 ${cls}`}>{children}</span>;
}

type BtnVariant = "primary" | "ghost" | "danger" | "quiet";
export function Btn({ variant = "ghost", className = "", type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const base = "inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-accent";
  const styles: Record<BtnVariant, string> = {
    primary: "bg-accent text-accent-ink font-semibold shadow-sm hover:bg-accent-hover active:bg-accent-dim",
    ghost: "border border-line bg-panel text-ink hover:border-accent/40 hover:bg-raised active:bg-control",
    danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
    quiet: "text-ink-muted hover:bg-white/5 hover:text-ink",
  };
  return <button {...rest} type={type} className={`${base} ${styles[variant]} ${className}`} />;
}

export function Card({ title, children, action, id }: { title?: string; children: ReactNode; action?: ReactNode; id?: string }) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={title ? headingId : undefined} className="rounded-2xl border border-line bg-panel p-5 shadow-card">
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 id={headingId} className="text-base font-semibold">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** Label + control + optional hint/error. The label, hint and error are wired to the control. */
export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactElement<InputHTMLAttributes<HTMLElement>> }) {
  const autoId = useId();
  const hintId = useId();
  const errId = useId();
  const controlId = (children.props as { id?: string }).id ?? autoId;
  const describedBy = [hint ? hintId : "", error ? errId : ""].filter(Boolean).join(" ") || undefined;
  const control = cloneElement(children, { id: controlId, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined } as Record<string, unknown>);
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label htmlFor={controlId} className="font-medium text-ink">{label}</label>
      {control}
      {hint && <span id={hintId} className="text-xs text-ink-muted">{hint}</span>}
      {error && <span id={errId} role="alert" className="text-xs text-danger">{error}</span>}
    </div>
  );
}

export const inputCls = "h-10 w-full rounded-xl border border-line bg-panel px-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent/70 focus:outline-none disabled:opacity-50 aria-[invalid=true]:border-danger";

export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-40 ${checked ? "border-transparent bg-accent" : "border-line bg-raised"}`}
    >
      <span className={`absolute inset-y-0.5 start-0.5 aspect-square rounded-full shadow-sm transition-[transform,background-color] duration-200 ease-out ${checked ? "translate-x-5 bg-accent-ink rtl:-translate-x-5" : "translate-x-0 bg-white"}`} />
    </button>
  );
}

export function Modal({ title, onClose, children, size = "md" }: { title: string; onClose: () => void; children: ReactNode; size?: "md" | "lg" }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(ref, onClose);
  return (
    <div className="fixed inset-0 z-overlay grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`w-full ${size === "lg" ? "max-w-lg" : "max-w-md"} rounded-2xl border border-line bg-panel p-5 shadow-dialog focus:outline-none`}
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 id={titleId} className="font-semibold">{title}</h3>
          <button aria-label={t("dialog.close")} title={t("dialog.close")} onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-white/5 hover:text-ink"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Confirmation for destructive actions. Cancel is the default focus. */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel, busy = false, danger = true }: {
  title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; busy?: boolean; danger?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="flex flex-col gap-5">
        <div className="text-sm text-ink-muted">{body}</div>
        <div className="flex justify-end gap-2">
          <Btn onClick={onCancel}>{t("common.cancel")}</Btn>
          <Btn variant={danger ? "danger" : "primary"} disabled={busy} onClick={onConfirm}>{confirmLabel}</Btn>
        </div>
      </div>
    </Modal>
  );
}
