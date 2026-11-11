import { useEffect, useState } from "react";
import { useApp } from "../store/app";
import { LaunchBar } from "../components/LaunchBar";
import { useI18n } from "../i18n/useI18n";
import hero1 from "../assets/hero-1.jpg";
import hero2 from "../assets/hero-2.jpg";

/** Banner pictures. Add or swap files in src/assets and list them here; they cross-fade in turn. */
const HEROES = [hero1, hero2];

/** Small rounded label used for the loader / version chips on the banner and for the news links. */
const chip = "rounded-full bg-black/45 px-4 py-1 text-[0.8125rem] font-medium text-white backdrop-blur-sm";

export function Home() {
  const { t } = useI18n();
  const { instances, selectedInstance } = useApp();
  const [heroIdx, setHeroIdx] = useState(() => Math.floor(Math.random() * HEROES.length));
  useEffect(() => {
    const id = window.setInterval(() => setHeroIdx((n) => (n + 1) % HEROES.length), 12_000);
    return () => window.clearInterval(id);
  }, []);
  const inst = instances.find((i) => i.id === selectedInstance) ?? null;
  const shownVersion = inst?.versionId ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="relative isolate min-h-0 flex-1 overflow-hidden rounded-[22px] bg-panel [clip-path:inset(0_round_22px)]">
        {HEROES.map((src, i) => (
          <img key={src} src={src} alt="" aria-hidden draggable={false} className={`hero-zoom absolute inset-0 h-full w-full object-cover object-[50%_40%] transition-opacity duration-1000 ${i === heroIdx ? "opacity-100" : "opacity-0"}`} />
        ))}
        <div className="hero-shade absolute inset-0" aria-hidden />
        <div className="fade-up absolute bottom-7 start-7 flex flex-col gap-4">
          {shownVersion ? (
            <h1 className="text-[5rem] font-bold leading-none tracking-[0.012em] text-white/90 [text-shadow:0_2px_24px_rgba(0,0,0,.35)]" dir="ltr">{shownVersion}</h1>
          ) : (
            <h1 className="max-w-md text-2xl font-semibold leading-snug text-white">{t(instances.length ? "launch.chooseInstance" : "home.noInstance")}</h1>
          )}
          {inst && (
            <div className="flex flex-wrap items-center gap-2" dir="ltr">
              <span className={chip}>{t(`loader.${inst.loader}`)}</span>
              <span className={chip}>{inst.versionId}</span>
              {inst.loader !== "vanilla" && inst.loaderVersion && <span className={chip}>{inst.loaderVersion}</span>}
            </div>
          )}
        </div>
      </div>

      <LaunchBar />
    </div>
  );
}
