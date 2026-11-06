import { Play, Box, Package, Gamepad2, SquareTerminal, UserRound, Settings, type IconType } from "./icons";
import { useApp } from "../store/app";
import { useI18n } from "../i18n/useI18n";
import type { Key } from "../i18n";

type Dest = "home" | "instances" | "mods" | "controls" | "help";

/** Left rail: the four pages, then website / donate / account / settings. Fixed in every language. */
export function Sidebar() {
  const collapsed = true; // phone: icon rail only
  const { t } = useI18n();
  const page = useApp((s) => s.page);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const setPage = useApp((s) => s.setPage);
  const openInstances = useApp((s) => s.openInstances);
  const openMods = useApp((s) => s.openMods);
  const openSettings = useApp((s) => s.openSettings);
  const openAccounts = useApp((s) => s.openAccounts);
  const accountsOpen = useApp((s) => s.accountsOpen);

  const active: Record<Dest, boolean> = {
    home: page === "home",
    instances: page === "instances",
    mods: page === "mods",
    controls: page === "controls",
    help: page === "help",
  };
  const go: Record<Dest, () => void> = {
    home: () => setPage("home"),
    instances: () => openInstances(false),
    mods: () => openMods("installed"),
    controls: () => setPage("controls"),
    help: () => setPage("help"),
  };
  const label: Record<Dest, Key> = { home: "nav.home", instances: "nav.instances", mods: "nav.mods", controls: "nav.controls", help: "nav.help" };

  const row = `relative flex h-10 w-full items-center ${collapsed ? "justify-center" : "gap-3 px-3"} rounded-xl text-start text-[0.9375rem] font-semibold transition-colors duration-150 focus-visible:outline-accent`;
  const item = (dest: Dest, Icon: IconType) => {
    const on = active[dest] && !settingsOpen;
    const tone = on ? "bg-accent-dim text-accent" : "text-ink-muted hover:bg-white/5 hover:text-ink";
    return (
      <button key={dest} type="button" aria-label={t(label[dest])} title={collapsed ? t(label[dest]) : undefined} aria-current={on ? "page" : undefined} onClick={go[dest]} className={`${row} ${tone}`}>
        {on && <span aria-hidden className="absolute start-0 top-2.5 h-6 w-[3px] rounded-full bg-accent" />}
        <Icon size={24} active={on} aria-hidden />
        {!collapsed && <span className="truncate">{t(label[dest])}</span>}
      </button>
    );
  };

  const small = `${row} !h-10 text-[0.875rem] font-medium text-ink-muted hover:bg-white/5 hover:text-ink`;

  return (
    <nav aria-label={t("nav.main")} className={`shell-sidebar relative my-2 ms-2 flex shrink-0 flex-col overflow-y-auto rounded-[22px] bg-panel p-2 transition-[width] duration-200 ${collapsed ? "w-[4.5rem]" : "w-[13rem]"}`}>
      <div className="flex flex-col gap-1">
        {item("home", Play)}
        {item("instances", Box)}
        {item("mods", Package)}
        {item("controls", Gamepad2)}
        {item("help", SquareTerminal)}
      </div>
      <div className="mt-auto flex flex-col gap-0.5 border-t border-line pt-2.5">
        <button type="button" title={collapsed ? t("menu.account") : undefined} aria-label={t("menu.account")} aria-current={accountsOpen ? "page" : undefined} className={`${small} ${accountsOpen ? "!bg-accent-dim !text-accent" : ""}`} onClick={() => openAccounts()}><UserRound size={20} className="mx-0.5" aria-hidden />{!collapsed && <span>{t("menu.account")}</span>}</button>
        <button type="button" title={collapsed ? t("nav.settings") : undefined} aria-label={t("nav.settings")} aria-current={settingsOpen ? "page" : undefined} onClick={() => openSettings()} className={`${small} ${settingsOpen ? "!bg-accent-dim !text-accent" : ""}`}><Settings size={20} className="mx-0.5" aria-hidden />{!collapsed && <span>{t("nav.settings")}</span>}</button>
      </div>
    </nav>
  );
}
