import React, { useEffect, useState } from "react";
import { Sparkles, Check, X, Loader2, AlertTriangle, RefreshCw, Info } from "lucide-react";
import { Card } from "./Card";
import { Btn } from "./Btn";
import { apiFetch, readJson, apiErrorMessage } from "../../lib/apiClient";

export type AIProviderDisclosure = {
  name: string;
  model: string;
};

export type AIDescription = {
  positives: string[];
  negatives: string[];
  summary: string;
  provider?: AIProviderDisclosure;
};

function AIDescription({
  title,
  fetchFn,
  className,
  reloadKey,
}: {
  title: string;
  fetchFn: () => Promise<AIDescription | null>;
  className?: string;
  reloadKey?: string | number;
}) {
  const [data, setData] = useState<AIDescription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn();
      if (result === null) {
        setUnavailable(true);
        setData(null);
      } else {
        setUnavailable(false);
        setData(result);
      }
    } catch (e: any) {
      setError(e?.message || "خطا در دریافت توصیف");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [reloadKey]);

  return (
    <Card className={`p-5 border-2 border-purple-500/40 bg-gradient-to-br from-purple-50/60 via-white to-purple-50/30 dark:from-card dark:via-card dark:to-card dark:border-purple-400/30 shadow-md shadow-purple-500/10 relative overflow-hidden ${className || ""}`}>
      <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-full blur-2xl pointer-events-none" />
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-500/18 text-purple-600 dark:text-purple-300 flex items-center justify-center flex-shrink-0 shadow-sm border border-purple-200 dark:border-purple-500/35">
          <Sparkles size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-foreground">{title}</h3>
            <span className="text-[10px] font-semibold bg-purple-100 dark:bg-purple-500/18 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/35 px-2 py-0.5 rounded-full">
              تحلیل هوش مصنوعی
            </span>
          </div>
        </div>
      </div>

      {data?.provider && (
        <p role="note" className="mb-3 flex items-start gap-1.5 text-[10px] leading-5 text-muted-foreground">
          <Info size={12} className="mt-0.5 flex-shrink-0" />
          <span>
            ارائه‌دهنده: <strong className="text-foreground">{data.provider.name}</strong> · مدل: <strong className="text-foreground">{data.provider.model}</strong>.
            داده‌های لازم برای این تحلیل به این سرویس ارسال می‌شوند.
          </span>
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-card/80 rounded-xl p-3.5 border border-purple-100 dark:border-purple-500/35">
          <Loader2 size={14} className="animate-spin text-purple-600 dark:text-purple-300" />در حال تحلیل…
        </div>
      ) : unavailable ? (
        <p className="text-xs text-muted-foreground leading-relaxed bg-card/80 rounded-xl p-3.5 border border-purple-100 dark:border-purple-500/35">
          برای این بخش هوش مصنوعی فعال نشده است. لطفاً API را در پنل مدیریت پیکربندی کنید.
        </p>
      ) : error ? (
        <div className="flex items-center justify-between gap-3 bg-card/80 rounded-xl p-3.5 border border-red-100 dark:border-red-500/35">
          <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-300">
            <AlertTriangle size={14} />{error}
          </div>
          <Btn variant="secondary" size="xs" onClick={load}><RefreshCw size={11} />تلاش مجدد</Btn>
        </div>
      ) : data ? (
        <div className="space-y-3">
          {data.summary && (
            <p className="text-xs text-foreground/90 leading-relaxed bg-card/80 backdrop-blur-sm border border-purple-100 dark:border-purple-500/35 rounded-xl p-3.5 shadow-sm">
              {data.summary}
            </p>
          )}

          {data.positives.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 mb-1.5">نکات مثبت</p>
              <ul className="space-y-1.5">
                {data.positives.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-foreground/90 bg-emerald-50/70 dark:bg-emerald-500/12 border border-emerald-100 dark:border-emerald-500/35 rounded-lg px-2.5 py-1.5">
                    <Check size={13} className="text-emerald-600 dark:text-emerald-300 flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.negatives.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-red-700 dark:text-red-300 mb-1.5">نکات منفی</p>
              <ul className="space-y-1.5">
                {data.negatives.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-foreground/90 bg-red-50/70 dark:bg-red-500/12 border border-red-100 dark:border-red-500/35 rounded-lg px-2.5 py-1.5">
                    <X size={13} className="text-red-500 dark:text-red-300 flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}

export { AIDescription };

export function makeAIDescriptionFetcher(
  entity: "consultant" | "property",
  id: string | number,
  csrfToken?: string
): () => Promise<AIDescription | null> {
  return async () => {
    const res = await apiFetch(
      `/common/api/ai/${entity}/${id}/`,
      { method: "POST" },
      csrfToken
    );
    if (res.status === 503) return null;
    if (!res.ok) {
      const payload = await readJson(res);
      throw new Error(apiErrorMessage(payload, "خطا در دریافت توصیف"));
    }
    const payload = await readJson(res);
    return {
      positives: Array.isArray(payload.positives) ? payload.positives : [],
      negatives: Array.isArray(payload.negatives) ? payload.negatives : [],
      summary: typeof payload.summary === "string" ? payload.summary : "",
      provider:
        typeof payload.provider?.name === "string" &&
        typeof payload.provider?.model === "string"
          ? { name: payload.provider.name, model: payload.provider.model }
          : undefined,
    };
  };
}
