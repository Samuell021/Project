import { useMemo, useState } from "react";
import { Badge } from "../../../shared/components/ui/Badge";
import { EmptyState } from "../../../shared/components/ui/EmptyState";
import { JalaliDateTimeInput } from "../../../shared/components/ui/JalaliDateTimeInput";
import { usePermissions, type Role } from "../../../shared/lib/permissions";
import { Btn, Card, Field, SearchBar, Shell, inputCls } from "../components/CrmUIKit";
import { post } from "../lib/crmApi";
import { useLoad } from "../lib/useCrmLoad";
import { formatFaMoney, formatFaNumber } from "../lib/commercialDomain";
import type { CrmNavigate, Row } from "../types";

const INTEREST_LABELS: Record<string, string> = {
  UNKNOWN: "بی‌پاسخ",
  INTERESTED: "علاقه‌مند",
  NOT_INTERESTED: "بدون علاقه",
};

export function Introductions({
  csrfToken,
  navigate,
  initialRecordId,
  role,
  currentUserId,
}: {
  csrfToken: string;
  navigate: CrmNavigate;
  initialRecordId?: string | null;
  role: Role;
  currentUserId?: string | null;
}) {
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [interest, setInterest] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState({ customer_interest: "INTERESTED", rejection_reason: "", feedback: "" });
  const [schedule, setSchedule] = useState({ scheduled_at: "", notes: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page_size: "100" });
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    if (initialRecordId) params.set("inquiry", String(initialRecordId));
    return `/crm/api/introductions/?${params.toString()}`;
  }, [search, status, initialRecordId]);

  const urls = useMemo(() => [query, "/crm/api/viewings/?page_size=300", "/crm/api/deals/?page_size=300"], [query]);
  const { data, error, loading, reload } = useLoad(urls, csrfToken);
  const introductions: Row[] = (data[query] || []).filter((item: Row) => !interest || item.customer_interest === interest);
  const viewings: Row[] = data[urls[1]] || [];
  const deals: Row[] = data[urls[2]] || [];
  const selected = introductions.find((item) => String(item.id) === String(selectedId)) || null;
  const selectedViewings = selected ? viewings.filter((item) => String(item.introduction) === String(selected.id)) : [];
  const interestedViewing = selectedViewings.find((item) => item.completed_at && item.result === "INTERESTED");
  const selectedDeal = selected ? deals.find((item) => String(item.introduction) === String(selected.id) && !["LOST"].includes(item.stage)) : null;
  const snapshot = (selected?.introduced_terms_snapshot || {}) as Row;

  async function act(target: string, body: Row, success: string) {
    setBusy(true);
    try {
      await post(csrfToken, target, body);
      setMessage(success);
      await reload();
    } catch (errorValue) {
      setMessage(errorValue instanceof Error ? errorValue.message : "عملیات ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title="معرفی‌ها"
      subtitle="هر معرفی تصویر شرایط فایل را در خود دارد؛ بازخورد متقاضی و هماهنگی بازدید روی همین معرفی ثبت می‌شود."
      error={error}
      loading={loading && !Object.keys(data).length}
      onReload={reload}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <SearchBar value={search} onChange={setSearch} placeholder="جست‌وجو بر اساس کد درخواست، فایل یا متقاضی…" flush />
        <Btn onClick={() => navigate("crm-inquiries")}>فهرست درخواست‌ها</Btn>
      </div>
      <div className="mb-4 grid gap-2 md:grid-cols-3">
        <select aria-label="وضعیت معرفی" value={status} onChange={(event) => setStatus(event.target.value)} className={inputCls}>
          <option value="">همهٔ وضعیت‌ها</option>
          <option value="OPEN">باز</option>
          <option value="CLOSED">بسته</option>
        </select>
        <select aria-label="علاقه متقاضی" value={interest} onChange={(event) => setInterest(event.target.value)} className={inputCls}>
          <option value="">همهٔ بازخوردها</option>
          {Object.entries(INTEREST_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <div className="flex items-center text-xs text-muted-foreground">{formatFaNumber(introductions.length)} معرفی در این نما</div>
      </div>
      {message ? <div role="status" className="mb-4 rounded-xl bg-secondary px-4 py-3 text-sm">{message}</div> : null}
      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <div className="space-y-3">
          {introductions.map((item) => (
            <Card key={item.id} className={`cursor-pointer space-y-2 hover:border-emerald-500 ${String(item.id) === String(selectedId) ? "border-emerald-600" : ""}`}>
              <button type="button" className="w-full text-right" onClick={() => setSelectedId(String(item.id))}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground">{item.inquiry_code}</div>
                    <strong>{item.property_file_title}</strong>
                  </div>
                  <Badge
                    label={INTEREST_LABELS[item.customer_interest] || "بی‌پاسخ"}
                    variant={item.customer_interest === "INTERESTED" ? "success" : item.customer_interest === "NOT_INTERESTED" ? "danger" : "muted"}
                  />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">متقاضی: {item.contact_name} · مشاور متقاضی: {item.buyer_consultant_name || "—"} · مشاور ملک: {item.seller_consultant_name || "—"}</div>
                <div className="mt-1 text-xs text-muted-foreground">ثبت: {item.created_at ? new Date(item.created_at).toLocaleString("fa-IR") : "نامشخص"}</div>
              </button>
            </Card>
          ))}
          {!introductions.length && !loading ? <EmptyState title="معرفی‌ای یافت نشد" description="فیلترها را تغییر دهید یا از فهرست درخواست‌ها فایل معرفی کنید." /> : null}
        </div>
        <Card className="space-y-3">
          {selected ? (
            <>
              <div>
                <div className="text-xs text-muted-foreground">{selected.inquiry_code} · {selected.status}</div>
                <h2 className="text-lg font-bold">{selected.property_file_title}</h2>
                <p className="text-xs text-muted-foreground">متقاضی: {selected.contact_name}</p>
              </div>
              <dl className="grid gap-2 rounded-xl border p-3 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">منطقه</dt><dd>{snapshot.district || "نامشخص"}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">متراژ</dt><dd>{formatFaNumber(snapshot.area)} متر</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">مبلغ فروش</dt><dd>{formatFaMoney(snapshot.sale_price)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">ودیعه</dt><dd>{formatFaMoney(snapshot.deposit)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">اجارهٔ ماهانه</dt><dd>{formatFaMoney(snapshot.monthly_rent)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">وضعیت فایل هنگام معرفی</dt><dd>{snapshot.status || "نامشخص"}</dd></div>
              </dl>
              <div className="space-y-2">
                <h3 className="font-bold">بازخورد متقاضی</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select value={feedback.customer_interest} onChange={(event) => setFeedback({ ...feedback, customer_interest: event.target.value })} className={inputCls}>
                    <option value="INTERESTED">علاقه‌مند</option>
                    <option value="NOT_INTERESTED">بدون علاقه</option>
                  </select>
                  <input value={feedback.rejection_reason} onChange={(event) => setFeedback({ ...feedback, rejection_reason: event.target.value })} placeholder="دلیل رد (در صورت عدم علاقه الزامی)" className={inputCls} />
                  <input value={feedback.feedback} onChange={(event) => setFeedback({ ...feedback, feedback: event.target.value })} placeholder="یادداشت بازخورد" className={`${inputCls} sm:col-span-2`} />
                </div>
                <Btn
                  disabled={busy || (feedback.customer_interest === "NOT_INTERESTED" && !feedback.rejection_reason.trim())}
                  onClick={() => act(`/crm/api/introductions/${selected.id}/feedback/`, { ...feedback, version: selected.version }, "بازخورد معرفی ثبت شد.")}
                >
                  ثبت بازخورد
                </Btn>
              </div>
              <div className="space-y-2 border-t pt-3">
                <h3 className="font-bold">بازدید</h3>
                {can("viewing.manage") && selected.status === "OPEN" ? (
                  <>
                    <JalaliDateTimeInput name="viewing_at" label="زمان بازدید" value={schedule.scheduled_at} onChange={(value) => setSchedule((current) => ({ ...current, scheduled_at: value }))} required />
                    <Field label="یادداشت هماهنگی">
                      <input value={schedule.notes} onChange={(event) => setSchedule({ ...schedule, notes: event.target.value })} className={inputCls} />
                    </Field>
                    <Btn disabled={!schedule.scheduled_at || busy} onClick={() => act("/crm/api/viewings/", { introduction: selected.id, scheduled_at: schedule.scheduled_at, notes: schedule.notes }, "بازدید زمان‌بندی شد.")}>
                      ثبت زمان بازدید
                    </Btn>
                  </>
                ) : null}
                {selectedViewings.map((item) => (
                  <div key={item.id} className="rounded-xl border p-2 text-xs">
                    {new Date(item.scheduled_at).toLocaleString("fa-IR")} · {item.result || "PENDING"} · مسئول: {item.assigned_to_name || "—"}
                  </div>
                ))}
                {!selectedViewings.length ? <p className="text-xs text-muted-foreground">بازدیدی ثبت نشده است.</p> : null}
              </div>
              <div className="space-y-2 border-t pt-3">
                <h3 className="font-bold">مذاکره</h3>
                {selectedDeal ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 text-sm">
                    <span>{selectedDeal.stage_label || selectedDeal.stage}</span>
                    <Btn color="light" onClick={() => navigate("crm-deals", selectedDeal.id)}>صفحهٔ مذاکره</Btn>
                  </div>
                ) : interestedViewing && can("deal.manage") ? (
                  <Btn disabled={busy} onClick={() => act("/crm/api/deals/", { viewing: interestedViewing.id }, "مذاکره آغاز شد.")}>شروع مذاکره از بازدید مورد پسند</Btn>
                ) : (
                  <p className="text-xs text-muted-foreground">برای شروع مذاکره، نتیجهٔ بازدیدی با علاقهٔ متقاضی لازم است.</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Btn color="light" onClick={() => navigate("crm-inquiries", selected.inquiry)}>پروندهٔ متقاضی</Btn>
                <Btn color="light" onClick={() => navigate("crm-viewings")}>تقویم بازدیدها</Btn>
                <span className="self-center text-xs text-muted-foreground">{currentUserId ? `شناسهٔ شما: ${currentUserId}` : ""} {role === "admin" ? "· مدیر کل" : ""}</span>
              </div>
            </>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">یک معرفی را انتخاب کنید.</p>
          )}
        </Card>
      </div>
    </Shell>
  );
}
