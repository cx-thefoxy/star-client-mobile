import { useEffect, useId, useRef, useState } from "react";
import { useApp } from "../store/app";
import { api } from "../services/tauri";
import { Btn, ConfirmDialog, Field, Modal, Pill, inputCls, useDialog, useLayerExit } from "./ui";
import { SkinHead } from "./SkinPreview";
import { SkinHead3D, useAccountSkin, useSkinLookup } from "./SkinHead3D";
import { Check, ChevronDown, LayoutGrid, Trash2, UserRound, Users, X } from "./icons";
import { useI18n } from "../i18n/useI18n";
import { describeError } from "../i18n/errors";
import type { Account } from "../types/api";

/**
 * The accounts layer: opens over any page (Home account button, "Manage accounts", sidebar Account).
 * Left: the active account with a big 3D head of its skin (or a live preview of the name being typed).
 * Right: the account list (tick = use this account, bin = remove) and an "Add account" menu.
 */
export function AccountsLayer() {
  const { t, lang } = useI18n();
  const { accounts, refreshAccounts, closeAccounts, toast } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [removing, setRemoving] = useState<Account | null>(null);
  const { leaving, leave } = useLayerExit(closeAccounts);
  useDialog(ref, () => { if (menuOpen) setMenuOpen(false); else leave(); }, !removing && !offlineOpen && !leaving);

  const active = accounts?.accounts.find((a) => a.id === accounts.active) ?? null;
  const activeSkin = useAccountSkin(active);
  const typed = name.trim();
  const draft = useSkinLookup(typed, offlineOpen);
  const previewing = offlineOpen && typed.length > 0;
  const authOff = accounts?.auth.configured === false;

  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [menuOpen]);

  useEffect(() => {
    if (offlineOpen) { const id = window.setTimeout(() => nameRef.current?.focus(), 0); return () => window.clearTimeout(id); }
  }, [offlineOpen]);

  const closeOffline = () => { setOfflineOpen(false); setName(""); setErr(null); };

  const addOffline = async () => {
    setErr(null);
    setAdding(true);
    try {
      await api.addOfflineAccount(typed);
      await refreshAccounts();
      toast("info", { key: "settings.offline.added", params: { name: typed } });
      closeOffline();
    } catch (e) { setErr(describeError(lang, e)); }
    finally { setAdding(false); }
  };

  const signIn = async () => {
    setMenuOpen(false);
    setSigningIn(true);
    try {
      const a = await api.signIn();
      await refreshAccounts();
      toast("info", { key: "settings.signedIn", params: { name: a.name } });
    } catch (e) { toast("error", { error: e }); }
    finally { setSigningIn(false); }
  };

  const makeActive = async (a: Account) => {
    try {
      await api.setActiveAccount(a.id);
      await refreshAccounts();
      toast("info", { key: "settings.account.activeSet", params: { name: a.name } });
    } catch (e) { toast("error", { error: e }); }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    try {
      await api.removeAccount(removing.id);
      await refreshAccounts();
      toast("info", { key: "settings.signedOut", params: { name: removing.name } });
    } catch (e) { toast("error", { error: e }); }
    finally { setRemoving(null); }
  };

  const skinNote = draft.status === "loading" ? t("accounts.skin.loading")
    : draft.status === "found" ? t("accounts.skin.found")
    : draft.status === "missing" ? t("accounts.skin.missing")
    : draft.status === "error" ? t("accounts.skin.error") : null;

  const list = accounts?.accounts ?? [];
  const shownName = previewing ? typed : active?.name ?? t("launch.noActiveAccount");

  return (
    <div className={`settings-overlay fixed inset-0 z-overlay grid place-items-center bg-black/45 p-4 ${leaving ? "is-leaving" : ""}`} onMouseDown={(e) => { if (e.target === e.currentTarget) leave(); }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 backdrop-blur-[2px]" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`settings-dialog ${leaving ? "is-leaving" : ""} relative flex max-h-[min(35rem,calc(100vh-2rem))] w-full max-w-3xl min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/30 backdrop-blur-3xl shadow-dialog focus:outline-none`}>
        <div className="flex items-center justify-between gap-3 px-6 pb-2 pt-5">
          <h1 id={titleId} className="text-base font-semibold tracking-tight">{t("accounts.title")}</h1>
          <button type="button" aria-label={t("accounts.close")} title={t("accounts.close")} onClick={leave} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-raised text-ink-muted hover:text-ink"><X size={17} aria-hidden /></button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[11rem_minmax(0,1fr)] gap-4 px-6 pb-3 pt-2">
          <div className="flex min-h-0 flex-col items-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.05] p-4">
            <div className="grid flex-1 place-items-center">
              <SkinHead3D skinUrl={previewing ? draft.url : activeSkin} size={104} label={t("account.skin", { name: previewing ? typed : active?.name ?? "Steve" })} />
            </div>
            <div className="flex w-full items-end justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[0.9375rem] font-semibold">{shownName}</div>
                {(previewing || active) && (
                  <div className={`truncate text-sm ${!previewing && active?.needsRelogin ? "text-danger" : "text-ink-muted"}`}>
                    {previewing ? t("accounts.newOffline") : active && (active.needsRelogin ? t("account.needsRelogin") : t(`account.type.${active.accountType}`))}
                  </div>
                )}
              </div>
              {!previewing && active && <Pill active>{t("account.active")}</Pill>}
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint">{t("accounts.list")}</div>
            {authOff && <p className="text-xs text-ink-muted">{t("launch.authNotConfigured", { path: "docs/AUTH_SETUP.md" })}</p>}
            {list.length > 0 ? (
              <ul role="list" className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
                {list.map((a) => {
                  const on = accounts?.active === a.id;
                  return (
                    <li key={a.id} className={`flex items-center gap-3 rounded-xl border bg-white/[0.05] p-3 ${on ? "border-accent/40" : "border-line"}`}>
                      <button type="button" role="radio" aria-checked={on} aria-label={`${t("settings.account.setActive")}: ${a.name}`} title={t("settings.account.setActive")} onClick={() => { if (!on) void makeActive(a); }}
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-colors focus-visible:outline-accent ${on ? "border-accent bg-accent text-accent-ink" : "border-line bg-raised text-transparent hover:border-accent/60"}`}>
                        <Check size={14} strokeWidth={2.4} aria-hidden />
                      </button>
                      <SkinHead account={a} className="h-10 w-10" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.9375rem] font-semibold">{a.name}</span>
                        <span className={`block truncate text-xs ${a.needsRelogin ? "text-danger" : "text-ink-muted"}`}>{a.needsRelogin ? t("account.needsRelogin") : t(`account.type.${a.accountType}`)}</span>
                      </span>
                      <button type="button" aria-label={`${a.accountType === "offline" ? t("accounts.remove") : t("settings.signOut")}: ${a.name}`} title={a.accountType === "offline" ? t("accounts.remove") : t("settings.signOut")} onClick={() => setRemoving(a)}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-accent"><Trash2 size={18} aria-hidden /></button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="grid flex-1 place-items-center rounded-2xl border border-white/10 bg-white/[0.05] p-6">
                <div className="flex flex-col items-center gap-2 text-center">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-raised text-ink-muted"><Users size={18} aria-hidden /></span>
                  <div className="text-sm font-semibold">{t("accounts.emptyTitle")}</div>
                  <p className="text-xs text-ink-muted">{t("accounts.emptyBody")}</p>
                  <div className="mt-2 flex flex-wrap justify-center gap-2">
                    <Btn variant="primary" disabled={signingIn || authOff} onClick={() => void signIn()}><LayoutGrid size={16} aria-hidden />{t("accounts.microsoft")}</Btn>
                    <Btn onClick={() => { setErr(null); setOfflineOpen(true); }}><UserRound size={16} aria-hidden />{t("accounts.offline")}</Btn>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end px-6 pb-5 pt-1">
          <div ref={menuRef} className="relative">
            <Btn variant="primary" aria-haspopup="menu" aria-expanded={menuOpen} disabled={signingIn} onClick={() => setMenuOpen((o) => !o)}>
              <UserRound size={16} aria-hidden />{signingIn ? t("settings.signingIn") : t("accounts.add")}<ChevronDown size={16} aria-hidden />
            </Btn>
            {menuOpen && (
              <div role="menu" className="absolute bottom-full right-0 z-10 mb-2 w-72 rounded-xl border border-line bg-panel p-1 shadow-dialog">
                <button type="button" role="menuitem" disabled={authOff} onClick={() => void signIn()} className="flex w-full items-start gap-3 rounded-lg p-2.5 text-left hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-accent">
                  <LayoutGrid size={18} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden />
                  <span><span className="block text-sm font-medium">{t("accounts.microsoft")}</span><span className="block text-xs text-ink-muted">{t("accounts.microsoftHint")}</span></span>
                </button>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setErr(null); setOfflineOpen(true); }} className="flex w-full items-start gap-3 rounded-lg p-2.5 text-left hover:bg-raised focus-visible:outline-accent">
                  <UserRound size={18} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden />
                  <span><span className="block text-sm font-medium">{t("accounts.offline")}</span><span className="block text-xs text-ink-muted">{t("accounts.offlineHint")}</span></span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {offlineOpen && (
        <Modal title={t("settings.offline.title")} onClose={closeOffline}>
          <form className="flex flex-col gap-3" noValidate onSubmit={(e) => { e.preventDefault(); if (typed && !adding) void addOffline(); }}>
            <p className="text-sm text-ink-muted">{t("settings.offline.body")}</p>
            <Field label={t("settings.offline.username")} hint={t("settings.offline.rule")} error={err}>
              <input ref={nameRef} className={inputCls} maxLength={36} dir="ltr" placeholder={t("settings.offline.placeholder")} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            {skinNote && <p aria-live="polite" className="text-xs text-ink-muted">{skinNote}</p>}
            <div className="flex justify-end gap-2">
              <Btn onClick={closeOffline}>{t("common.cancel")}</Btn>
              <Btn type="submit" variant="primary" disabled={!typed || adding}>{t("settings.offline.add")}</Btn>
            </div>
          </form>
        </Modal>
      )}
      {removing && (
        <ConfirmDialog title={t("settings.signOutTitle")} body={t("settings.signOutBody", { name: removing.name })} confirmLabel={removing.accountType === "offline" ? t("accounts.remove") : t("settings.signOut")}
          onCancel={() => setRemoving(null)} onConfirm={() => void confirmRemove()} />
      )}
    </div>
  );
}
