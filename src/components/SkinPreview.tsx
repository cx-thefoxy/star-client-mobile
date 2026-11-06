import { useEffect, useState } from "react";
import type { Account } from "../types/api";
import { useI18n } from "../i18n/useI18n";
import steve from "../assets/steve-head.png";
import { useAccountSkin } from "./SkinHead3D";

/** Shows the account's skin when available, otherwise the Steve head picture. Falls back if the skin fails to load. */
export function SkinPreview({ account, size = "md" }: { account: Account; size?: "sm" | "md" | "lg" }) {
  const { t } = useI18n();
  const [broken, setBroken] = useState(false);
  const dims = size === "lg" ? "h-40 w-28" : size === "sm" ? "h-9 w-8" : "h-16 w-12";
  if (account.skinUrl && !broken) {
    return <img src={account.skinUrl} alt={t("account.skin", { name: account.name })} onError={() => setBroken(true)} className={`${dims} rounded-lg object-cover object-top`} />;
  }
  return <img src={steve} alt={t("account.skin", { name: account.name })} className={`${dims} object-contain`} />;
}

/** Small avatar for the launch bar: the face of the account's skin when available, otherwise the Steve head picture. */
export function SkinHead({ account, className = "h-6 w-6" }: { account: Account; className?: string }) {
  const [broken, setBroken] = useState(false);
  const skinUrl = useAccountSkin(account);
  useEffect(() => { setBroken(false); }, [skinUrl]);
  if (skinUrl && !broken) {
    const layer = (left: string) => (
      <img src={skinUrl} alt="" aria-hidden draggable={false} onError={() => setBroken(true)}
        className="pixelated absolute max-w-none" style={{ width: "800%", left, top: "-100%" }} />
    );
    return <span aria-hidden className={`${className} relative block shrink-0 overflow-hidden rounded-md bg-control`}>{layer("-100%")}{layer("-500%")}</span>;
  }
  return <img src={steve} alt="" aria-hidden draggable={false} className={`${className} shrink-0 object-contain`} />;
}
