import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Plus } from "lucide-react";
import { Badge } from "../../../shared/components/ui/Badge";
import { EmptyState } from "../../../shared/components/ui/EmptyState";
import { Tabs } from "../../../shared/components/ui/Foundation";
import { JalaliDateInput } from "../../../shared/components/ui/JalaliDateInput";
import { JalaliDateTimeInput } from "../../../shared/components/ui/JalaliDateTimeInput";
import { usePermissions, type Role } from "../../../shared/lib/permissions";
import { Btn, Card, Field, SearchBar, Shell, inputCls } from "../components/CrmUIKit";
import { CaseActivityPanel, CaseManagementActions } from "../components/CasePanels";
import { MatchPanel } from "../components/MatchPanel";
import { NeedsEditor, emptyNeedsRow, needsRowsPayload, preferenceToNeedsRow } from "../components/NeedsEditor";
import { IntroductionModal } from "../components/IntroductionModal";
import { post } from "../lib/crmApi";
import { useLoad } from "../lib/useCrmLoad";
import { INQUIRY_STAGE_LABELS, budgetLabel, formatFaMoney, formatFaNumber, stepGuidance, type InquiryRecord, type MatchResult } from "../lib/commercialDomain";
import type { CrmNavigate, Row } from "../types";

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "فعال",
  CLOSED: "بسته",
  CANCELLED: "لغوشده",
  DUPLICATE: "تکراری",
  COMPLETED: "تکمیل‌شده",
};

const DETAIL_TABS = [
  { key: "summary", label: "خلاصه" },
  { key: "needs", label: "نیاز و بودجه" },
  { key: "matches", label: "فایل‌های پیشنهادی" },
  { key: "introductions", label: "معرفی‌شده" },
  { key: "viewings", label: "بازدیدها" },
  { key: "followups", label: "پیگیری‌ها" },
  { key: "deals", label: "مذاکرات" },
  { key: "contracts", label: "قراردادها" },
  { key: "history", label: "تاریخچه" },
];

export function Inquiries({
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
  const [dealType, setDealType] = useState("");
  const [assignee, setAssignee] = useState("");
  const [range, setRange] = useState("");
  const [createdAfter, setCreatedAfter] = useState("");
  const [createdBefore, setCreatedBefore] = useState("");
  const [tab, setTab] = useState("summary");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialRecordId ? String(initialRecordId) : null);
  const [needsRows, setNeedsRows] = useState([emptyNeedsRow()]);
  const [introOpen, setIntroOpen] = useState(false);
  const [introTarget, setIntroTarget] = useState<MatchResult | null>(null);
  const [followForm, setFollowForm] = useState<Record<string, string>>({ title: "", type: "Call", date: "", notes: "" });
  const [followResult, setFollowResult] = useState<Record<string, Record<string, string>>>({});
  const [dealReason, setDealReason] = useState("");
  const [closeStatus, setCloseStatus] = useState({ status: "CLOSED", reason: "" });

  useEffect(() => {
    if (initialRecordId) setSelectedId(String(initialRecordId));
  }, [initialRecordId]);

  const inquiryQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page_size", "100");
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    if (dealType) params.set("deal_type", dealType);
    if (assignee) params.set("assigned_to", assignee);
    if (range) params.set("sales_range", range);
    if (createdAfter) params.set("created_after", createdAfter);
    if (createdBefore) params.set("created_before", createdBefore);
    return `/crm/api/inquiries/?${params.toString()}`;
  }, [search, status, dealType, assignee, range, createdAfter, createdBefore]);

  const detailUrls = useMemo(() => {
    if (!selectedId) return [];
    return [
      `/crm/api/inquiries/${selectedId}/`,
      `/crm/api/inquiries/${selectedId}/matches/`,
      `/crm/api/introductions/?inquiry=${selectedId}&page_size=100`,
      `/crm/api/viewings/?inquiry=${selectedId}&page_size=100`,
      `/crm/api/deals/?inquiry=${selectedId}&page_size=100`,
      `/crm/api/contracts/?inquiry=${selectedId}&page_size=100`,
      `/followups/api/followups/?page_size=100`,
    ];
  }, [selectedId]);

  const referenceUrls = useMemo(
    () => [
      "/crm/api/scopes/?page_size=100",
      "/crm/api/scope-memberships/?page_size=300",
      "/basics/api/deal-types/?page_size=100",
      "/basics/api/districts/?page_size=300",
      "/basics/api/property-types/?page_size=100",
    ],
    [],
  );

  const { data, error, loading, reload } = useLoad([inquiryQuery, ...referenceUrls, ...detailUrls], csrfToken);
  const rows: InquiryRecord[] = data[inquiryQuery] || [];
  const scopes: Row[] = data[referenceUrls[0]] || [];
  const memberships: Row[] = data[referenceUrls[1]] || [];
  const dealTypes: Row[] = data[referenceUrls[2]] || [];
  const districts: Row[] = data[referenceUrls[3]] || [];
  const propertyTypes: Row[] = data[referenceUrls[4]] || [];
  const selected: InquiryRecord | null = selectedId ? (data[`/crm/api/inquiries/${selectedId}/`] as InquiryRecord | undefined) || null : null;
  const matches: MatchResult[] = selectedId ? (data[`/crm/api/inquiries/${selectedId}/matches/`] as MatchResult[] | undefined) || [] : [];
  const introductions: Row[] = selectedId ? (data[`/crm/api/introductions/?inquiry=${selectedId}&page_size=100`] as Row[] | undefined) || [] : [];
  const viewings: Row[] = selectedId ? (data[`/crm/api/viewings/?inquiry=${selectedId}&page_size=100`] as Row[] | undefined) || [] : [];
  const deals: Row[] = selectedId ? (data[`/crm/api/deals/?inquiry=${selectedId}&page_size=100`] as Row[] | undefined) || [] : [];
  const contracts: Row[] = selectedId ? (data[`/crm/api/contracts/?inquiry=${selectedId}&page_size=100`] as Row[] | undefined) || [] : [];
  const allFollowUps: Row[] = data["/followups/api/followups/?page_size=100"] || [];
  const followUps = useMemo(() => allFollowUps.filter((item) => String(item.inquiryId ?? item.inquiry) === String(selectedId)), [allFollowUps, selectedId]);

  useEffect(() => {
    if (!selected) {
      setNeedsRows([emptyNeedsRow(dealTypes[0]?.id)]);
      return;
    }
    const existing = selected.preferences || [];
    setNeedsRows(existing.length ? existing.map((item) => preferenceToNeedsRow(item as Row)) : [emptyNeedsRow(dealTypes[0]?.id)]);
  }, [selected?.id, selected?.version, dealTypes.length]);

  async function act(target: string, body: Row = {}, success = "انجام شد.") {
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

  function openInquiry(id: string | number) {
    setSelectedId(String(id));
    setTab("summary");
    setMessage("");
  }

  const nextAction = selected ? stepGuidance(selected, role, currentUserId) : null;
  const needSummary = selected?.preferences?.length
    ? selected.preferences.map((item) => budgetLabel(item, dealTypes.find((type) => String(type.id) === String(item.deal_type))?.family)).join(" · ")
    : "نیاز ثبت نشده است";

  return (
    <Shell
      title="درخواست‌های متقاضی"
      subtitle="نیاز و بودجه برای هر نوع معامله جداست؛ تطبیق فقط پیشنهاد می‌دهد و معرفی با اقدام صریح ثبت می‌شود."
      error={error}
      loading={loading && !Object.keys(data).length}
      onReload={reload}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <SearchBar value={search} onChange={setSearch} placeholder="جست‌وجو بر اساس کد درخواست، متقاضی، تلفن یا مسئول…" flush />
        <Btn onClick={() => navigate("crm-inquiry-register")}><Plus size={16} /> ثبت درخواست متقاضی</Btn>
      </div>
      <div className="mb-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        <select aria-label="وضعیت" value={status} onChange={(event) => setStatus(event.target.value)} className={inputCls}>
          <option value="">همهٔ وضعیت‌ها</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select aria-label="نوع معامله" value={dealType} onChange={(event) => setDealType(event.target.value)} className={inputCls}>
          <option value="">همهٔ انواع معامله</option>
          {dealTypes.map((type) => <option key={type.id} value={type.id}>{type.display_name || type.name}</option>)}
        </select>
        <select aria-label="مسئول" value={assignee} onChange={(event) => setAssignee(event.target.value)} className={inputCls}>
          <option value="">همهٔ مسئولان</option>
          {memberships.map((member) => <option key={`${member.id}-${member.user}`} value={member.user}>{member.full_name || member.user_name}</option>)}
        </select>
        <select aria-label="رنج" value={range} onChange={(event) => setRange(event.target.value)} className={inputCls}>
          <option value="">همهٔ رنج‌ها</option>
          {scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.name}</option>)}
        </select>
        <JalaliDateInput label="از تاریخ" value={createdAfter} onChange={setCreatedAfter} />
        <JalaliDateInput label="تا تاریخ" value={createdBefore} onChange={setCreatedBefore} />
      </div>
      {message ? <div role="status" className="mb-4 rounded-xl bg-secondary px-4 py-3 text-sm">{message}</div> : null}
      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <div className="space-y-3">
          {rows.map((row) => (
            <Card
              key={row.id}
              className={`cursor-pointer space-y-2 transition-colors hover:border-emerald-500 ${String(row.id) === String(selectedId) ? "border-emerald-600" : ""}`}
            >
              <button type="button" className="w-full text-right" onClick={() => openInquiry(row.id)}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground">{row.code}</div>
                    <strong>{row.contact_name}</strong>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge label={INQUIRY_STAGE_LABELS[row.stage] || row.stage_label || "نامشخص"} variant={row.status === "ACTIVE" ? "info" : "muted"} />
                    <Badge label={STATUS_LABELS[row.status] || row.status} variant={row.status === "ACTIVE" ? "success" : "muted"} />
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">مسئول: {row.assigned_to_name || "تعیین نشده"} · رنج: {row.sales_range_name || "نامشخص"}</div>
                <div className="mt-1 text-xs text-muted-foreground">نیاز: {row.preferences?.length ? row.preferences.map((item) => budgetLabel(item)).join(" · ") : "ثبت نشده"}</div>
                <div className="mt-1 text-xs text-muted-foreground">آخرین به‌روزرسانی: {row.updated_at ? new Date(row.updated_at).toLocaleString("fa-IR") : "نامشخص"}</div>
                <div className="mt-1 text-xs text-muted-foreground">اقدام بعدی: {stepGuidance(row, role, currentUserId).headline}</div>
              </button>
            </Card>
          ))}
          {!rows.length && !loading ? <EmptyState title="درخواستی یافت نشد" description="فیلترها را تغییر دهید یا درخواست تازه‌ای ثبت کنید." /> : null}
        </div>

        <Card className="space-y-3">
          {selected ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">{selected.code}</div>
                  <h2 className="text-lg font-bold">{selected.contact_name}</h2>
                  <p className="text-xs text-muted-foreground">تلفن: {selected.contact_phone || "بر اساس دسترسی"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Btn onClick={() => navigate("crm-inquiry-register", selected.id)}>ادامهٔ مسیر مرحله‌ای</Btn>
                  <Btn color="light" onClick={() => navigate("crm-contacts", selected.contact)}>مشاهدهٔ شخص</Btn>
                </div>
              </div>
              <Tabs value={tab} tabs={DETAIL_TABS} onChange={setTab} />
              {tab === "summary" ? (
                <div className="space-y-3">
                  <div className="rounded-xl border p-3">
                    <h3 className="mb-1 font-bold">جعبهٔ کار</h3>
                    <p className="text-sm">{nextAction?.headline}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{nextAction?.body}</p>
                    <p className="mt-2 text-xs text-muted-foreground">مسئول مرحله: {selected.stage_responsible || "—"} · مهلت: {selected.due_at ? new Date(selected.due_at).toLocaleString("fa-IR") : "نامشخص"}</p>
                  </div>
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <div className="rounded-xl bg-secondary px-3 py-2">نیاز: {needSummary}</div>
                    <div className="rounded-xl bg-secondary px-3 py-2">آخرین فعالیت: {selected.updated_at ? new Date(selected.updated_at).toLocaleString("fa-IR") : "نامشخص"}</div>
                  </div>
                  {["CLOSED", "CANCELLED", "DUPLICATE"].includes(selected.status) ? (
                    <p className="rounded-xl bg-muted px-3 py-2 text-xs">دلیل بستن: {selected.description || "ثبت نشده"}</p>
                  ) : null}
                  {can("inquiry.manage") && selected.status === "ACTIVE" ? (
                    <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-500/35 dark:bg-amber-500/12">
                      <Field label="وضعیت پایانی">
                        <select value={closeStatus.status} onChange={(event) => setCloseStatus({ ...closeStatus, status: event.target.value })} className={inputCls}>
                          <option value="CLOSED">بستن درخواست</option>
                          <option value="CANCELLED">لغو درخواست</option>
                          <option value="DUPLICATE">تکراری</option>
                        </select>
                      </Field>
                      <Field label="دلیل الزامی">
                        <input value={closeStatus.reason} onChange={(event) => setCloseStatus({ ...closeStatus, reason: event.target.value })} className={inputCls} />
                      </Field>
                      <Btn
                        color="light"
                        disabled={!closeStatus.reason.trim() || busy}
                        onClick={() => act(`/crm/api/inquiries/${selected.id}/change_status/`, { status: closeStatus.status, reason: closeStatus.reason.trim(), version: selected.version }, "وضعیت درخواست ثبت شد.")}
                      >
                        ثبت وضعیت
                      </Btn>
                    </div>
                  ) : null}
                  <CaseManagementActions
                    csrfToken={csrfToken}
                    subject={selected as unknown as Row}
                    subjectType="inquiry"
                    scopes={scopes}
                    candidates={rows as unknown as Row[]}
                    enabled={can("inquiry.manage")}
                    onChanged={reload}
                  />
                </div>
              ) : null}
              {tab === "needs" ? (
                <div className="space-y-3">
                  <NeedsEditor rows={needsRows} onChange={setNeedsRows} dealTypes={dealTypes} districts={districts} propertyTypes={propertyTypes} />
                  <Btn
                    disabled={busy}
                    onClick={() => act(`/crm/api/inquiries/${selected.id}/save_needs/`, { version: selected.version, preferences: needsRowsPayload(needsRows) }, "نیاز و بودجه ثبت شد.")}
                  >
                    ذخیرهٔ نیاز و بودجه
                  </Btn>
                </div>
              ) : null}
              {tab === "matches" ? (
                <MatchPanel
                  matches={matches}
                  offerable={can("introduction.manage")}
                  busy={busy}
                  onIntroduce={(match) => { setIntroTarget(match); setIntroOpen(true); }}
                  onFeedback={() => navigate("crm-introductions", selected.id)}
                />
              ) : null}
              {tab === "introductions" ? (
                <div className="space-y-2">
                  {introductions.map((item) => (
                    <div key={item.id} className="rounded-xl border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>{item.property_file_title} · {item.status}</span>
                        <Badge label={item.customer_interest === "NOT_INTERESTED" ? "بدون علاقه" : item.customer_interest === "INTERESTED" ? "علاقه‌مند" : "بی‌پاسخ"} variant={item.customer_interest === "INTERESTED" ? "success" : item.customer_interest === "NOT_INTERESTED" ? "danger" : "muted"} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">مشاور متقاضی: {item.buyer_consultant_name || "—"} · مشاور ملک: {item.seller_consultant_name || "—"}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Btn color="light" onClick={() => act(`/crm/api/introductions/${item.id}/feedback/`, { customer_interest: "INTERESTED", version: item.version }, "بازخورد ثبت شد.")}>علاقه‌مند</Btn>
                        <Btn color="light" onClick={() => navigate("crm-introductions", selected.id)}>ثبت دلیل عدم علاقه</Btn>
                      </div>
                    </div>
                  ))}
                  {!introductions.length ? <p className="text-sm text-muted-foreground">فایلی معرفی نشده است.</p> : null}
                </div>
              ) : null}
              {tab === "viewings" ? (
                <div className="space-y-2">
                  {viewings.map((item) => (
                    <div key={item.id} className="rounded-xl border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>{new Date(item.scheduled_at).toLocaleString("fa-IR")} · {item.property_file_title}</span>
                        <Badge label={item.completed_at ? "نتیجه ثبت شده" : "در انتظار"} variant={item.completed_at ? "muted" : "warning"} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">مسئول: {item.assigned_to_name || "—"} · نتیجه: {item.result || "PENDING"}</p>
                    </div>
                  ))}
                  <Btn color="light" onClick={() => navigate("crm-viewings")}>تقویم بازدیدها</Btn>
                </div>
              ) : null}
              {tab === "followups" ? (
                <div className="space-y-3">
                  {followUps.map((item) => (
                    <div key={item.id} className="rounded-xl border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>{item.title} · {new Date(item.date).toLocaleString("fa-IR")}</span>
                        <Badge label={item.status === "completed" ? "انجام‌شده" : "برنامه‌ریزی‌شده"} variant={item.status === "completed" ? "muted" : "info"} />
                      </div>
                      {item.status !== "completed" ? (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <input value={followResult[item.id]?.outcome || ""} onChange={(event) => setFollowResult({ ...followResult, [item.id]: { ...followResult[item.id], outcome: event.target.value } })} placeholder="نتیجهٔ پیگیری" className={inputCls} />
                          <input value={followResult[item.id]?.next_action || ""} onChange={(event) => setFollowResult({ ...followResult, [item.id]: { ...followResult[item.id], next_action: event.target.value } })} placeholder="اقدام بعدی (اختیاری)" className={inputCls} />
                          {/* A date + clock pair owns a whole row: in a half-width track it used to
                              spill over the next field. */}
                          <div className="sm:col-span-2">
                            <JalaliDateTimeInput name={`next_${item.id}`} label="زمان اقدام بعدی" value={followResult[item.id]?.next_action_at || ""} onChange={(value) => setFollowResult({ ...followResult, [item.id]: { ...followResult[item.id], next_action_at: value } })} />
                          </div>
                          <div className="flex justify-end sm:col-span-2">
                            <Btn color="light" disabled={!followResult[item.id]?.outcome} onClick={() => act(`/followups/api/followups/${item.id}/complete/`, followResult[item.id] || {}, "پیگیری تکمیل شد.")}>ثبت نتیجه</Btn>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  <div className="grid gap-2 rounded-xl border p-3 sm:grid-cols-2">
                    <Field label="موضوع پیگیری"><input value={followForm.title} onChange={(event) => setFollowForm({ ...followForm, title: event.target.value })} className={inputCls} /></Field>
                    <Field label="نوع">
                      <select value={followForm.type} onChange={(event) => setFollowForm({ ...followForm, type: event.target.value })} className={inputCls}>
                        <option value="Call">تماس</option>
                        <option value="Meeting">جلسه</option>
                        <option value="Email">ایمیل</option>
                        <option value="Site Visit">بازدید</option>
                      </select>
                    </Field>
                    {/* «زمان پیگیری» is a date + clock pair, so it takes a full row instead of a
                        half track where the two controls overlapped each other. */}
                    <div className="sm:col-span-2">
                      <JalaliDateTimeInput name="follow_date" label="زمان پیگیری" value={followForm.date} onChange={(value) => setFollowForm((current) => ({ ...current, date: value }))} required />
                    </div>
                    <div className="sm:col-span-2">
                      <Field label="یادداشت"><input value={followForm.notes} onChange={(event) => setFollowForm({ ...followForm, notes: event.target.value })} className={inputCls} /></Field>
                    </div>
                    <div className="sm:col-span-2">
                      <Btn
                        disabled={!followForm.title.trim() || !followForm.date || busy}
                        onClick={() => act("/followups/api/followups/", { title: followForm.title, type: followForm.type, contact: selected.contact_name, date: followForm.date, consultantId: currentUserId ? Number(currentUserId) : null, inquiryId: selected.id, notes: followForm.notes }, "پیگیری ثبت شد.")}
                      >
                        ثبت پیگیری
                      </Btn>
                    </div>
                  </div>
                </div>
              ) : null}
              {tab === "deals" ? (
                <div className="space-y-2">
                  {deals.map((item) => (
                    <div key={item.id} className="rounded-xl border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>{item.property_file_title} · {item.stage_label || item.stage}</span>
                        <Btn color="light" onClick={() => navigate("crm-deals", item.id)}>صفحهٔ مذاکره</Btn>
                      </div>
                      {item.stage === "NEGOTIATION" ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <input value={dealReason} onChange={(event) => setDealReason(event.target.value)} placeholder="دلیل عدم توافق" className={`${inputCls} max-w-xs`} />
                          <Btn color="light" onClick={() => act(`/crm/api/deals/${item.id}/succeed/`, { version: item.version }, "توافق ثبت شد.")}>نتیجهٔ موفق</Btn>
                          <Btn color="light" disabled={!dealReason.trim()} onClick={() => act(`/crm/api/deals/${item.id}/close/`, { closure_reason: dealReason.trim(), version: item.version }, "عدم توافق ثبت شد.")}>عدم توافق</Btn>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {!deals.length ? <p className="text-sm text-muted-foreground">مذاکره‌ای ثبت نشده است.</p> : null}
                </div>
              ) : null}
              {tab === "contracts" ? (
                <div className="space-y-2">
                  {contracts.map((item) => (
                    <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm">
                      <span>{item.contract_number} · {item.status}</span>
                      <Btn color="light" onClick={() => navigate("crm-contracts", item.id)}>صفحهٔ قرارداد</Btn>
                    </div>
                  ))}
                  {!contracts.length ? <p className="text-sm text-muted-foreground">قراردادی ثبت نشده است.</p> : null}
                </div>
              ) : null}
              {tab === "history" ? <CaseActivityPanel csrfToken={csrfToken} subject={selected as unknown as Row} subjectType="inquiry" /> : null}
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <ClipboardList size={28} />
              <p>یک درخواست را از فهرست انتخاب کنید.</p>
              <p className="text-xs">آمار این فهرست: {formatFaNumber(rows.length)} درخواست · بیشترین مبلغ نیاز: {formatFaMoney(rows[0]?.preferences?.[0]?.max_amount)}</p>
            </div>
          )}
        </Card>
      </div>
      <IntroductionModal
        open={introOpen}
        match={introTarget}
        busy={busy}
        onClose={() => { setIntroOpen(false); setIntroTarget(null); }}
        onConfirm={() => {
          if (!introTarget || !selected) return;
          void act(`/crm/api/inquiries/${selected.id}/introduce/`, { listing_id: introTarget.property_file_id }, "فایل معرفی شد.");
          setIntroOpen(false);
          setIntroTarget(null);
        }}
      />
    </Shell>
  );
}

