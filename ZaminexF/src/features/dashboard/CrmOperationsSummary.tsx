import React, { useEffect, useState } from "react";
import { Building2, FileText, Handshake, Inbox } from "lucide-react";
import { KpiCard } from "../../shared/components/ui/KpiCard";
import { apiFetch } from "../../shared/lib/apiClient";
import { jalaliToGregorianISO, toJalaliISO } from "../../shared/lib/jdate";
import type { Page } from "../../shared/lib/types";

type DashboardCounters = {
  property_cases?: number;
  pending_leads?: number;
  pending_reviews?: number;
  open_deals?: number;
};

type CrmOperationsSummaryData = {
  counters?: DashboardCounters;
  finance?: { claimed?: string; received?: string; shares_paid?: string; outstanding?: string };
};

const faNumber = (value: unknown): string =>
  typeof value === "number" ? value.toLocaleString("fa-IR") : "۰";

const faAmount = (value: unknown): string => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString("fa-IR") : "۰";
};

function rangeForLastDays(days: number) {
  const today = new Date();
  const start = new Date(today.getTime() - days * 86400000);
  const from = jalaliToGregorianISO(toJalaliISO(start.toISOString()));
  const to = jalaliToGregorianISO(toJalaliISO(today.toISOString()));
  return `from=${from}&to=${to}`;
}

function CrmOperationsSummary({ navigate }: { navigate: (page: Page) => void }) {
  const [summary, setSummary] = useState<CrmOperationsSummaryData | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/crm/api/dashboard/summary/?${rangeForLastDays(30)}`, { method: "GET" });
        if (!res.ok) return;
        const data = (await res.json()) as CrmOperationsSummaryData;
        if (!cancelled) setSummary(data);
      } catch {
        return;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!summary) return null;

  const counters = summary.counters || {};
  const finance = summary.finance || {};

  const cards: Array<{ label: string; value: string; icon: React.ReactNode; color: string; target: Page }> = [
    { label: "پرونده‌های ملک", value: faNumber(counters.property_cases), icon: <Building2 size={18} />, color: "bg-blue-50 dark:bg-blue-500/12 text-blue-600 dark:text-blue-300", target: "crm-property-cases" },
    { label: "سرنخ در انتظار پذیرش", value: faNumber(counters.pending_leads), icon: <Inbox size={18} />, color: "bg-amber-50 dark:bg-amber-500/12 text-amber-600 dark:text-amber-300", target: "crm-inbox" },
    { label: "ملک در انتظار بررسی", value: faNumber(counters.pending_reviews), icon: <FileText size={18} />, color: "bg-orange-50 dark:bg-orange-500/12 text-orange-600 dark:text-orange-300", target: "crm-reviews" },
    { label: "مذاکره‌های باز", value: faNumber(counters.open_deals), icon: <Handshake size={18} />, color: "bg-purple-50 dark:bg-purple-500/12 text-purple-600 dark:text-purple-300", target: "crm-deals" },
  ];

  return (
    <section aria-label="پرونده‌های CRM" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">پرونده‌های CRM</h2>
        {finance.claimed !== undefined && (
          <button type="button" onClick={() => navigate("crm-finance")} className="text-xs text-primary hover:underline">
            مطالبه کمیسیون {faAmount(finance.claimed)} تومان · وصول {faAmount(finance.received)} تومان
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <button type="button" key={card.label} onClick={() => navigate(card.target)} className="text-right">
            <KpiCard label={card.label} value={card.value} icon={card.icon} color={card.color} />
          </button>
        ))}
      </div>
    </section>
  );
}

export { CrmOperationsSummary };
