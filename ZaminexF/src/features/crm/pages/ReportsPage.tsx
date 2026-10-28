import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, BarChart3, CalendarRange, Loader2, RotateCcw } from "lucide-react";
import { Badge } from "../../../shared/components/ui/Badge";
import { EmptyState } from "../../../shared/components/ui/EmptyState";
import { Skeleton } from "../../../shared/components/ui/Foundation";
import { JalaliDateInput } from "../../../shared/components/ui/JalaliDateInput";
import { isISODate, tehranCalendarDate } from "../../../shared/lib/jdate";
import { usePageQuery } from "../../../shared/lib/pageQuery";
import { Btn, Card, Shell } from "../components/CrmUIKit";
import { useLoad } from "../lib/useCrmLoad";
import { moneyOrUnknown, numberOrUnknown } from "../lib/financeDomain";
import type { CrmNavigate, Row } from "../types";

type Metric = {
  key: string;
  label: string;
  value: number;
  hint: string;
  severity: "normal" | "warning";
  page: string | null;
};

type Summary = {
  role: "admin" | "range_manager" | "consultant" | "finance";
  range: { from: string; to: string };
  metrics: Metric[];
  team: Row[];
  finance: Record<string, string>;
  contract_queue?: { count: number; rows: Row[] };
  role_flags: { manager: boolean; consultant: boolean; finance: boolean; general_manager: boolean };
};

const REPORT_TABS = [
  { key: "funnel", label: "تبدیل" },
  { key: "advisors", label: "عملکرد مشاور" },
  { key: "stalled", label: "فایل‌های متوقف" },
  { key: "deals", label: "مذاکرات و قرارداد" },
  { key: "finance", label: "مالی" },
];

const TEAM_COLUMNS: { key: string; label: string }[] = [
  { key: "active_listings", label: "فایل فعال" },
  { key: "new_leads", label: "سرنخ جدید" },
  { key: "overdue_followups", label: "پیگیری عقب‌افتاده" },
  { key: "calls", label: "تماس" },
  { key: "viewings", label: "بازدید" },
  { key: "open_deals", label: "مذاکره باز" },
  { key: "won_deals", label: "معامله موفق" },
];

const DEFAULT_DAYS = 30;

// The filter dates live in Gregorian ISO form: that is the contract of `JalaliDateInput` (it
// renders Gregorian ISO as a Jalali calendar) and the form the reports API expects. Storing
// Jalali here used to show a nonsense year and to send a far-off range once a date was picked.
function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const start = new Date(today.getTime() - DEFAULT_DAYS * 86400000);
  return {
    from: tehranCalendarDate(start.toISOString()),
    to: tehranCalendarDate(today.toISOString()),
  };
}

export function Reports({ csrfToken, navigate }: { csrfToken: string; navigate: CrmNavigate }) {
  const { query, update } = usePageQuery();
  const fallback = useMemo(defaultRange, []);
  const queryFrom = query.get("from") || "";
  const queryTo = query.get("to") || "";
  const startRange = { from: isISODate(queryFrom) ? queryFrom : fallback.from, to: isISODate(queryTo) ? queryTo : fallback.to };
  const [fromDate, setFromDate] = useState(startRange.from);
  const [toDate, setToDate] = useState(startRange.to);
  const [tab, setTab] = useState(query.get("tab") || "funnel");
  const [applied, setApplied] = useState({ from: startRange.from, to: startRange.to });

  const apiRange = useMemo(() => {
    if (!applied.from || !applied.to) return "";
    return `from=${applied.from}&to=${applied.to}`;
  }, [applied]);

  const summaryUrl = apiRange ? `/crm/api/dashboard/summary/?${apiRange}` : "";
  const reportsUrl = apiRange ? `/crm/api/reports/?${apiRange}` : "";
  const urls = useMemo(() => (apiRange ? [summaryUrl, reportsUrl] : []), [apiRange, summaryUrl, reportsUrl]);
  const { data, error, loading, reload } = useLoad(urls, csrfToken);
  const summary = (summaryUrl ? data[summaryUrl] : null) as Summary | null;
  const report = (reportsUrl ? data[reportsUrl] : null) as Row | null;
  const forbidden = /دسترسی/.test(error);

  useEffect(() => {
    update({ tab: tab === "funnel" ? null : tab }, true);
  }, [tab, update]);

  function applyRange(nextFrom: string, nextTo: string) {
    setFromDate(nextFrom);
    setToDate(nextTo);
    setApplied({ from: nextFrom, to: nextTo });
    update({ from: nextFrom || null, to: nextTo || null });
  }

  function quickRange(days: number) {
    const today = new Date();
    const start = new Date(today.getTime() - days * 86400000);
    applyRange(tehranCalendarDate(start.toISOString()), tehranCalendarDate(today.toISOString()));
  }

  return (
    // A report is a document, not a board: it flows in the shell's single scroll container.
    // Pinning it to `h-full` with an inner scrolling body gave the page a second, nested scroll
    // area — the extra scroll at the bottom that pushed the layout around inside the viewport.
    <Shell
      title="گزارش‌ها و داشبورد"
      subtitle="شاخص‌ها بر پایه رکوردهای مجاز کاربر و بازه زمانی محاسبه می‌شوند؛ ارزش معامله از مطالبه و وصول جدا است."
      error={error && !forbidden ? error : undefined}
      loading={false}
      onReload={reload}
    >
      <Card className="mb-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <CalendarRange size={15} className="text-primary" aria-hidden />
          بازه گزارش
        </div>
        {/* Every control of the row is a bottom-aligned flex item and the date fields carry
            their own min width, so the row lays out on one line instead of spilling over its
            neighbours (the fields used to be pinned to a narrower wrapper). */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[13rem] flex-1 sm:max-w-[14rem]">
            <JalaliDateInput label="از تاریخ" value={fromDate} onChange={setFromDate} />
          </div>
          <div className="min-w-[13rem] flex-1 sm:max-w-[14rem]">
            <JalaliDateInput label="تا تاریخ" value={toDate} onChange={setToDate} />
          </div>
          <Btn color="light" onClick={() => applyRange(fromDate, toDate)} disabled={!fromDate || !toDate || fromDate > toDate}>اعمال بازه</Btn>
          <div role="group" aria-label="بازه‌های آماده" className="flex flex-wrap items-center gap-2 sm:mr-auto">
            {[7, 30, 90].map((days) => (
              <Btn key={days} color="light" onClick={() => quickRange(days)}>{days.toLocaleString("fa-IR")} روز</Btn>
            ))}
            {/* The icon and its title live in one inline-flex box, so a narrow button can
                never stack the icon above the label. */}
            <Btn color="light" onClick={() => applyRange(fallback.from, fallback.to)}>
              <span className="inline-flex items-center gap-1.5"><RotateCcw size={13} aria-hidden />بازه پیش‌فرض</span>
            </Btn>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {forbidden ? (
          <Card>
            <EmptyState icon={<AlertTriangle size={22} />} title="دسترسی به گزارش‌ها ندارید" description="گزارش‌ها فقط برای مدیر کل، مدیر رنج، مالی و دارندگان مجوز تحلیل قابل مشاهده است." />
          </Card>
        ) : null}

        {loading && !summary ? <Skeleton label="در حال محاسبه شاخص‌ها" /> : null}

        {summary ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {summary.metrics.map((metric) => (
                <button
                  key={metric.key}
                  type="button"
                  onClick={() => metric.page && navigate(metric.page as never)}
                  className="rounded-2xl border bg-card p-4 text-right shadow-sm transition-colors hover:bg-secondary"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{metric.label}</span>
                    {metric.severity === "warning" ? <Badge variant="warning" label="نیازمند اقدام" /> : null}
                  </div>
                  <div className="mt-2 text-2xl font-bold">{metric.value.toLocaleString("fa-IR")}</div>
                  {metric.hint ? <div className="mt-1 text-xs text-muted-foreground">{metric.hint}</div> : null}
                </button>
              ))}
            </div>

            {summary.role_flags.finance ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card><div className="text-xs text-muted-foreground">مطالبه تأییدشده</div><div className="mt-1 text-lg font-bold">{moneyOrUnknown(summary.finance.claimed)}</div></Card>
                <Card><div className="text-xs text-muted-foreground">وصول</div><div className="mt-1 text-lg font-bold">{moneyOrUnknown(summary.finance.received)}</div></Card>
                <Card><div className="text-xs text-muted-foreground">سهم پرداختی</div><div className="mt-1 text-lg font-bold">{moneyOrUnknown(summary.finance.shares_paid)}</div></Card>
                <Card><div className="text-xs text-muted-foreground">مانده</div><div className="mt-1 text-lg font-bold">{moneyOrUnknown(summary.finance.outstanding)}</div></Card>
              </div>
            ) : null}

            {summary.role_flags.manager && summary.team.length > 0 ? (
              <Card className="overflow-x-auto">
                <h3 className="mb-3 text-sm font-bold">وضعیت تیم در بازه انتخابی</h3>
                <table className="w-full min-w-[42rem] text-sm">
                  <caption className="sr-only">وضعیت عملکرد اعضای تیم</caption>
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th scope="col" className="py-2 text-right">مشاور</th>
                      {TEAM_COLUMNS.map((column) => <th key={column.key} scope="col" className="py-2 text-right">{column.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.team.map((row) => (
                      <tr key={row.user_id} className="border-b last:border-0">
                        <td className="py-2">
                          <button type="button" className="flex items-center gap-1 font-medium text-emerald-700 hover:underline dark:text-emerald-300" onClick={() => navigate("consultants", row.user_id)}>
                            {row.name} <ArrowLeft size={12} aria-hidden />
                          </button>
                        </td>
                        {TEAM_COLUMNS.map((column) => (
                          <td key={column.key} className="py-2">{numberOrUnknown(String(row[column.key] ?? 0))}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ) : null}

            {summary.contract_queue && summary.contract_queue.count > 0 ? (
              <Card>
                <h3 className="mb-3 text-sm font-bold">صف قرارداد ({summary.contract_queue.count.toLocaleString("fa-IR")})</h3>
                <ul className="space-y-2 text-sm">
                  {summary.contract_queue.rows.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2">
                      <span>{row.contract_number} · {row.title}</span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant={row.status === "SIGNING" ? "warning" : "default"} label={row.status_label} />
                        {row.missing_signatures ? `${numberOrUnknown(String(row.missing_signatures))} امضای ناقص` : "امضاها کامل"}
                        {row.commissions === 0 ? " · بدون مطالبه" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </>
        ) : null}

        {report ? (
          <Card>
            <div role="tablist" aria-label="گزارش‌های عملیاتی" className="mb-4 flex flex-wrap gap-2">
              {REPORT_TABS.map((item) => (
                <button
                  key={item.key}
                  role="tab"
                  type="button"
                  aria-selected={tab === item.key}
                  onClick={() => setTab(item.key)}
                  className={`rounded-xl px-3 py-1.5 text-sm ${tab === item.key ? "bg-emerald-700 text-white" : "border bg-card hover:bg-secondary"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {tab === "funnel" ? (
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-7">
                {[
                  ["پرونده ثبت", "cases"],
                  ["درخواست متقاضی", "inquiries"],
                  ["معرفی", "introductions"],
                  ["بازدید", "viewings"],
                  ["مذاکره", "deals"],
                  ["قرارداد", "contracts"],
                  ["قطعی", "finalized"],
                ].map(([label, key]) => (
                  <div key={key} className="rounded-xl bg-surface-muted p-3 text-center">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="mt-1 text-xl font-bold">{numberOrUnknown(String(report.funnel?.[key] ?? 0))}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {tab === "advisors" ? (
              <div className="overflow-x-auto">
                {(report.advisors || []).length === 0 ? (
                  <EmptyState icon={<BarChart3 size={22} />} title="داده عملکردی در این بازه نیست" description="بازه را گسترده‌تر کنید یا از دسترسی مدیریتی استفاده کنید." />
                ) : (
                  <table className="w-full min-w-[40rem] text-sm">
                    <caption className="sr-only">عملکرد مشاوران در بازه</caption>
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th scope="col" className="py-2 text-right">مشاور</th>
                        {TEAM_COLUMNS.map((column) => <th key={column.key} scope="col" className="py-2 text-right">{column.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {report.advisors.map((row: Row) => (
                        <tr key={row.user_id} className="border-b last:border-0">
                          <td className="py-2 font-medium">{row.name}</td>
                          {TEAM_COLUMNS.map((column) => <td key={column.key} className="py-2">{numberOrUnknown(String(row[column.key] ?? 0))}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : null}
            {tab === "stalled" ? (
              (report.stalled_listings || []).length === 0 ? (
                <EmptyState icon={<CalendarRange size={22} />} title="فایل متوقفی نیست" description="فایل‌هایی که بیش از آستانه توقف در یک مرحله مانده‌اند اینجا دیده می‌شوند." />
              ) : (
                <table className="w-full text-sm">
                  <caption className="sr-only">فایل‌های متوقف</caption>
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th scope="col" className="py-2 text-right">عنوان</th>
                      <th scope="col" className="py-2 text-right">نوع معامله</th>
                      <th scope="col" className="py-2 text-right">روز در مرحله</th>
                      <th scope="col" className="py-2 text-right">اقدام</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.stalled_listings.map((row: Row) => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="py-2">{row.title}</td>
                        <td className="py-2">{row.deal_type}</td>
                        <td className="py-2 text-amber-700 dark:text-amber-300">{numberOrUnknown(String(row.days_in_stage))}</td>
                        <td className="py-2"><button type="button" className="text-emerald-700 hover:underline dark:text-emerald-300" onClick={() => navigate("property-file-detail", row.id)}>مشاهده فایل</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : null}
            {tab === "deals" ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-surface-muted p-3"><div className="text-xs text-muted-foreground">مذاکرات بازه</div><div className="text-lg font-bold">{numberOrUnknown(String(report.deals?.count ?? 0))}</div></div>
                  <div className="rounded-xl bg-surface-muted p-3"><div className="text-xs text-muted-foreground">قطعی‌شده</div><div className="text-lg font-bold">{numberOrUnknown(String(report.deals?.finalized ?? 0))}</div></div>
                  <div className="rounded-xl bg-surface-muted p-3"><div className="text-xs text-muted-foreground">ناموفق</div><div className="text-lg font-bold">{numberOrUnknown(String(report.deals?.lost ?? 0))}</div></div>
                </div>
                {report.deals?.value_mixed ? (
                  <p className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle size={14} /> ارزش معاملات چند نوع مختلف است و جمع کل نمایش داده نمی‌شود؛ هر ردیف جدا ارزیابی شود.</p>
                ) : null}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-sm">
                    <caption className="sr-only">ارزش معامله به تفکیک نوع</caption>
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th scope="col" className="py-2 text-right">نوع معامله</th>
                        <th scope="col" className="py-2 text-right">مذاکره</th>
                        <th scope="col" className="py-2 text-right">قرارداد</th>
                        <th scope="col" className="py-2 text-right">ثمن فروش</th>
                        <th scope="col" className="py-2 text-right">ودیعه</th>
                        <th scope="col" className="py-2 text-right">اجاره ماهانه</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(report.deals?.by_deal_type || []).map((row: Row) => (
                        <tr key={row.deal_type_id ?? row.deal_type} className="border-b last:border-0">
                          <td className="py-2 font-medium">{row.deal_type}</td>
                          <td className="py-2">{numberOrUnknown(String(row.deals))}</td>
                          <td className="py-2">{numberOrUnknown(String(row.contracts))}</td>
                          <td className="py-2">{moneyOrUnknown(row.sale_value)}</td>
                          <td className="py-2">{moneyOrUnknown(row.deposit_value)}</td>
                          <td className="py-2">{moneyOrUnknown(row.monthly_rent_value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            {tab === "finance" ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl bg-surface-muted p-3"><div className="text-xs text-muted-foreground">مطالبه</div><div className="text-lg font-bold">{moneyOrUnknown(report.finance?.claimed)}</div></div>
                <div className="rounded-xl bg-surface-muted p-3"><div className="text-xs text-muted-foreground">وصول</div><div className="text-lg font-bold">{moneyOrUnknown(report.finance?.received)}</div></div>
                <div className="rounded-xl bg-surface-muted p-3"><div className="text-xs text-muted-foreground">سهم پرداختی</div><div className="text-lg font-bold">{moneyOrUnknown(report.finance?.shares_paid)}</div></div>
                <div className="rounded-xl bg-surface-muted p-3"><div className="text-xs text-muted-foreground">مانده وصول</div><div className="text-lg font-bold">{moneyOrUnknown(report.finance?.outstanding)}</div></div>
              </div>
            ) : null}
          </Card>
        ) : null}

        {!loading && !summary && !forbidden && error ? (
          <Card>
            <div className="flex items-center gap-2 text-sm"><AlertTriangle size={15} /> گزارش‌ها بارگذاری نشد.</div>
            <Btn color="light" onClick={reload}><Loader2 size={13} /> تلاش دوباره</Btn>
          </Card>
        ) : null}
      </div>
    </Shell>
  );
}
