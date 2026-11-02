import { useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { Stethoscope, CheckCircle2, XCircle, MinusCircle, Loader2 } from "lucide-react";
import { tr } from "../lib/app-language";
import { doctorAllPassed, doctorLlmState, type DoctorChecks } from "../lib/doctor-summary";

interface Nav { toDashboard: () => void; toServices?: () => void }

function CheckRow({ label, ok, optional, detail, action }: {
  label: string;
  ok: boolean;
  /** A missing optional item is shown as neutral, not as a failure. */
  optional?: boolean;
  detail?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-border/30 last:border-0">
      {ok ? (
        <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
      ) : optional ? (
        <MinusCircle size={18} className="text-muted-foreground shrink-0" />
      ) : (
        <XCircle size={18} className="text-destructive shrink-0" />
      )}
      <span className="text-sm font-medium flex-1">{label}</span>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
      {action && (
        <button
          onClick={action.onClick}
          className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors shrink-0"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export function DoctorView({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, refetch } = useApi<DoctorChecks>("/doctor");
  const llmState = data ? doctorLlmState(data) : "failed";
  const allPassed = data ? doctorAllPassed(data) : false;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("nav.doctor")}</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="font-sans text-3xl flex items-center gap-3">
          <Stethoscope size={28} className="text-primary" />
          {t("doctor.title")}
        </h1>
        <button onClick={() => refetch()} className={`px-4 py-2 text-sm rounded-lg ${c.btnSecondary}`}>
          {t("doctor.recheck")}
        </button>
      </div>

      {!data ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-primary" />
        </div>
      ) : (
        <div className={`border ${c.cardStatic} rounded-lg p-5`}>
          <CheckRow label={t("doctor.inkosJson")} ok={data.inkosJson} />
          <CheckRow
            label={t("doctor.projectEnv")}
            ok={data.projectEnv}
            optional
            detail={data.projectEnv ? undefined : tr("可选", "Optional")}
          />
          <CheckRow
            label={t("doctor.globalEnv")}
            ok={data.globalEnv}
            optional
            detail={data.globalEnv ? undefined : tr("可选", "Optional")}
          />
          <CheckRow label={t("doctor.booksDir")} ok={data.booksDir} detail={`${data.bookCount} book(s)`} />
          <CheckRow
            label={t("doctor.llmApi")}
            ok={llmState === "connected"}
            detail={
              llmState === "connected"
                ? t("doctor.connected")
                : llmState === "no-key"
                  ? tr("未设置 AI 模型或 API Key", "No AI model or API key set up")
                  : t("doctor.failed")
            }
            {...(llmState !== "connected" && nav.toServices
              ? { action: { label: tr("设置模型", "Set up model"), onClick: nav.toServices } }
              : {})}
          />
        </div>
      )}

      {data && (
        <div className={`px-4 py-3 rounded-lg text-sm font-medium ${
          allPassed
            ? "bg-emerald-500/10 text-emerald-600"
            : "bg-amber-500/10 text-amber-600"
        }`}>
          {allPassed
            ? t("doctor.allPassed")
            : t("doctor.someFailed")
          }
        </div>
      )}
    </div>
  );
}
