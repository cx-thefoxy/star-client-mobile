import { useEffect, useRef, useState } from "react";
import { useApp } from "../store/app";
import { Btn, Card } from "../components/ui";
import { api, onGameLog } from "../services/tauri";
import { Wrench, Copy, Trash2 } from "../components/icons";
import { useI18n } from "../i18n/useI18n";
import type { Key } from "../i18n";

const LIMITS: Key[] = ["help.limit.online", "help.limit.forge", "help.limit.hud", "help.limit.news"];

/** Help & logs: live game output, diagnostics and known limitations. */
export function Help() {
  const { t } = useI18n();
  const { toast, instances, selectedInstance, launch, running } = useApp();
  const [report, setReport] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [logs, setLogs] = useState<{ id: number; instanceId: string; stream: string; line: string }[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const inst = instances.find((i) => i.id === selectedInstance) ?? null;
  const gameRunning = running.length > 0 || launch?.stage === "running";

  useEffect(() => {
    let seq = 0;
    const unlisten = onGameLog((line) => {
      setLogs((prev) => [...prev.slice(-1999), { id: ++seq, ...line }]);
    });
    return () => { unlisten.then((u) => u()).catch(() => {}); };
  }, []);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  const runDiagnostics = async () => {
    setReportBusy(true);
    try { setReport(await api.diagnosticsReport()); }
    catch (e) { toast("error", { error: e }); }
    finally { setReportBusy(false); }
  };
  const copyReport = async () => {
    if (!report) return;
    try { await navigator.clipboard.writeText(report); toast("info", { key: "common.copied" }); }
    catch { toast("error", { key: "common.copyFailed" }); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto rounded-2xl bg-panel p-4">
      <div>
        <h1 className="text-lg font-semibold">{t("help.title")}</h1>
        <p className="text-sm text-ink-muted">{t("help.subtitle")}</p>
      </div>

      <section aria-labelledby="game-log-title" className="flex min-h-[13.75rem] flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-chrome">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
          <div className="min-w-0">
            <h2 id="game-log-title" className="text-sm font-semibold">{t("help.logTitle")}</h2>
            {inst && <p className="truncate text-xs text-ink-muted">{t("help.logFor", { name: inst.name })}{gameRunning ? ` · ${t("status.running")}` : ""}</p>}
          </div>
          <div className="flex gap-2">
            <Btn variant="quiet" disabled={logs.length === 0} onClick={() => setLogs([])}><Trash2 size={14} aria-hidden />{t("help.logClear")}</Btn>
            <Btn variant="quiet" disabled={logs.length === 0} onClick={() => navigator.clipboard.writeText(logs.map((l) => l.line).join("\n")).then(() => toast("info", { key: "common.copied" })).catch(() => toast("error", { key: "common.copyFailed" }))}><Copy size={14} aria-hidden />{t("help.logCopy")}</Btn>
          </div>
        </header>
        <div ref={logRef} role="log" aria-label={t("help.logLabel")} aria-live="off" tabIndex={0} dir="ltr" className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-[0.75rem] leading-5 text-ink-muted">
          {logs.length === 0 ? <span className="text-ink-faint" dir="ltr">{t("help.logEmpty")}</span> : logs.map((l) => (
            <div key={l.id} className={l.stream === "stderr" ? "text-warn" : undefined}>{l.line}</div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Btn variant="primary" disabled={reportBusy} onClick={() => void runDiagnostics()}><Wrench size={15} aria-hidden />{reportBusy ? t("help.diagnosticsRunning") : t("help.diagnostics")}</Btn>
      </div>
      {report && (
        <Card title={t("help.reportTitle")} action={<Btn onClick={() => void copyReport()}><Copy size={14} aria-hidden />{t("help.copyReport")}</Btn>}>
          <pre dir="ltr" className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-3 text-[0.6875rem] text-ink-muted">{report}</pre>
        </Card>
      )}
      <details className="rounded-2xl border border-line bg-panel p-4">
        <summary className="cursor-pointer text-sm font-semibold">{t("help.limitations")}</summary>
        <ul className="mt-3 flex list-disc flex-col gap-2 ps-5 text-sm text-ink-muted">
          {LIMITS.map((k) => <li key={k}>{t(k)}</li>)}
        </ul>
      </details>
    </div>
  );
}
