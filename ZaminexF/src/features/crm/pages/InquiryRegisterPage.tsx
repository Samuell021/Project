import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { JalaliDateTimeInput } from "../../../shared/components/ui/JalaliDateTimeInput";
import { Badge } from "../../../shared/components/ui/Badge";
import { ConsultantCombobox } from "../../../shared/components/ui/ConsultantCombobox";
import { ContactCombobox, type ContactComboboxRow } from "../../../shared/components/ui/ContactCombobox";
import { usePermissions, type Role } from "../../../shared/lib/permissions";
import { Btn, Card, Field, Shell, inputCls } from "../components/CrmUIKit";
import { needsRowErrors, NeedsEditor, emptyNeedsRow, needsRowsPayload, preferenceToNeedsRow } from "../components/NeedsEditor";
import { MatchPanel } from "../components/MatchPanel";
import { IntroductionModal } from "../components/IntroductionModal";
import { post } from "../lib/crmApi";
import { buildAssignableStaffOptions, type AssignableStaffRow } from "../lib/staffDomain";
import { useLoad } from "../lib/useCrmLoad";
import { formatFaMoney, formatFaNumber, INQUIRY_STEPS, clearInquiryDraft, clearLastInquiryCase, deriveInquiryStep, readInquiryDraft, readLastInquiryCase, saveLastInquiryCase, stepGuidance, stepIndex, writeInquiryDraft, type InquiryRecord, type MatchResult } from "../lib/commercialDomain";
import type { CrmNavigate, Row } from "../types";

type NeedsRow = ReturnType<typeof emptyNeedsRow>;

export function InquiryRegisterPage({
  csrfToken,
  navigate,
  role,
  currentUserId,
  recordId,
}: {
  csrfToken: string;
  navigate: CrmNavigate;
  role: Role;
  currentUserId?: string | null;
  recordId?: string | null;
}) {
  const { can } = usePermissions();
  const userKey = String(currentUserId || "guest");
  const inquiryId = recordId && /^[1-9]\d{0,19}$/.test(String(recordId)) ? String(recordId) : null;
  const baseUrls = useMemo(
    () => [
      "/crm/api/contacts/?page_size=100",
      "/crm/api/scopes/?page_size=100",
      "/basics/api/deal-types/?page_size=100",
      "/basics/api/districts/?page_size=300",
      "/basics/api/property-types/?page_size=100",
    ],
    [],
  );
  const inquiryUrls = useMemo(
    () => (inquiryId ? [
      `/crm/api/inquiries/${inquiryId}/`,
      // Only a manager sees the assignment form, so only they may read the candidate list.
      ...(role === "admin" || role === "range_manager" ? [`/crm/api/inquiries/${inquiryId}/assignable-staff/`] : []),
      `/crm/api/inquiries/${inquiryId}/matches/`,
      `/crm/api/introductions/?inquiry=${inquiryId}&page_size=100`,
      `/crm/api/viewings/?page_size=200`,
      `/crm/api/deals/?page_size=200`,
      `/crm/api/contracts/?page_size=200`,
    ] : []),
    [inquiryId, role],
  );
  const { data, error, loading, reload } = useLoad([...baseUrls, ...inquiryUrls], csrfToken);
  const contacts: Row[] = data[baseUrls[0]] || [];
  const scopes: Row[] = data[baseUrls[1]] || [];
  const dealTypes: Row[] = data[baseUrls[2]] || [];
  const districts: Row[] = data[baseUrls[3]] || [];
  const propertyTypes: Row[] = data[baseUrls[4]] || [];
  const inquiry: InquiryRecord | null = inquiryId ? (data[`/crm/api/inquiries/${inquiryId}/`] as InquiryRecord | undefined) || null : null;
  const matches: MatchResult[] = inquiryId ? (data[`/crm/api/inquiries/${inquiryId}/matches/`] as MatchResult[] | undefined) || [] : [];
  const introductions: Row[] = inquiryId ? (data[`/crm/api/introductions/?inquiry=${inquiryId}&page_size=100`] as Row[] | undefined) || [] : [];
  const allViewings: Row[] = data["/crm/api/viewings/?page_size=200"] || [];
  const allDeals: Row[] = data["/crm/api/deals/?page_size=200"] || [];
  const allContracts: Row[] = data["/crm/api/contracts/?page_size=200"] || [];
  const viewings = useMemo(() => allViewings.filter((item) => String(item.inquiry_id) === String(inquiryId)), [allViewings, inquiryId]);
  const deals = useMemo(() => allDeals.filter((item) => String(item.inquiry) === String(inquiryId)), [allDeals, inquiryId]);
  const contracts = useMemo(() => allContracts.filter((item) => deals.some((deal) => String(deal.id) === String(item.deal))), [allContracts, deals]);
  const introIds = useMemo(() => new Set(introductions.map((item) => String(item.id))), [introductions]);
  const scopedViewings = useMemo(() => viewings.filter((item) => introIds.has(String(item.introduction))), [viewings, introIds]);

  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | { label: string; run: () => Promise<void> }>(null);
  const [createForm, setCreateForm] = useState<Record<string, string>>({ contact: "", sales_range: "", description: "" });
  const [assignForm, setAssignForm] = useState<Record<string, string>>({ assigned_to: "", due_at: "" });
  const [rejectReason, setRejectReason] = useState("");
  const [needsRows, setNeedsRows] = useState<NeedsRow[]>([emptyNeedsRow()]);
  const [viewingForm, setViewingForm] = useState<Record<string, string>>({ introduction: "", scheduled_at: "", notes: "" });
  const [viewingResult, setViewingResult] = useState<Record<string, string>>({});
  const [dealForm, setDealForm] = useState<Record<string, string>>({ viewing: "" });
  const [closeReason, setCloseReason] = useState("");
  const [introTarget, setIntroTarget] = useState<MatchResult | null>(null);
  const [introOpen, setIntroOpen] = useState(false);
  const [lastCase, setLastCase] = useState(() => readLastInquiryCase(userKey));

  const step = inquiry ? deriveInquiryStep(inquiry) : "lead";
  const activeIndex = stepIndex(step);
  const guidance = stepGuidance(inquiry, role, currentUserId);
  const isManager = role === "admin" || role === "range_manager";
  const isGeneralManager = role === "admin";

  useEffect(() => {
    if (inquiryId) return;
    const draft = readInquiryDraft(userKey, "new");
    if (draft) {
      setCreateForm((current) => ({
        contact: String(draft.fields.contact ?? current.contact),
        sales_range: String(draft.fields.sales_range ?? current.sales_range),
        description: String(draft.fields.description ?? current.description),
      }));
    }
  }, [userKey, inquiryId]);

  useEffect(() => {
    if (!inquiry) return;
    const existing = inquiry.preferences || [];
    setNeedsRows(existing.length ? existing.map((item) => preferenceToNeedsRow(item as Row)) : [emptyNeedsRow(dealTypes[0]?.id)]);
    setViewingForm((current) => ({ ...current, introduction: current.introduction || String(introductions[0]?.id || "") }));
    setDealForm((current) => ({ ...current, viewing: current.viewing || String(scopedViewings.find((item) => item.completed_at)?.id || "") }));
  }, [inquiry?.id, inquiry?.version, dealTypes.length]);

  useEffect(() => {
    if (!inquiry) return;
    saveLastInquiryCase(userKey, { id: inquiry.id, code: inquiry.code, contactName: inquiry.contact_name, stageLabel: inquiry.stage_label || "" });
  }, [inquiry?.id, inquiry?.version, userKey]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(true);
    setConfirmAction(null);
    try {
      await action();
      setMessage(label);
      await reload();
    } catch (errorValue) {
      setMessage(errorValue instanceof Error ? errorValue.message : "عملیات ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  function requestConfirm(label: string, action: () => Promise<void>) {
    setConfirmAction({ label, run: action });
  }

  function postAction(path: string, body: Row = {}): Promise<void> {
    return post(csrfToken, path, body).then(() => undefined);
  }

  function updateCreate(patch: Record<string, string>) {
    const next = { ...createForm, ...patch };
    setCreateForm(next);
    writeInquiryDraft(userKey, "new", next, null);
  }

  async function submitCreate() {
    const result = await post(csrfToken, "/crm/api/inquiries/", {
      contact: Number(createForm.contact),
      sales_range: createForm.sales_range ? Number(createForm.sales_range) : null,
      description: createForm.description,
    });
    clearInquiryDraft(userKey, "new");
    setMessage("درخواست ثبت شد و مراحل بعدی روی همین پرونده ادامه می‌یابد.");
    if (result?.id) navigate("crm-inquiry-register", result.id);
    else await reload();
  }

  async function submitNeeds() {
    if (!inquiry) return;
    const errors = needsRowErrors(needsRows);
    if (errors.length) {
      setMessage(errors[0]);
      return;
    }
    await run("نیاز و بودجه ثبت شد.", () =>
      postAction(`/crm/api/inquiries/${inquiry.id}/save_needs/`, { version: inquiry.version, preferences: needsRowsPayload(needsRows) }),
    );
  }

  async function introduce(match: MatchResult) {
    if (!inquiry) return;
    await run("فایل برای متقاضی معرفی شد.", () =>
      postAction(`/crm/api/inquiries/${inquiry.id}/introduce/`, { listing_id: match.property_file_id }),
    );
    setIntroOpen(false);
    setIntroTarget(null);
  }

  const selectedIntro = introductions.find((item) => String(item.id) === String(viewingForm.introduction));
  const candidateUsers = buildAssignableStaffOptions(
    data[inquiryId ? `/crm/api/inquiries/${inquiryId}/assignable-staff/` : ""] as AssignableStaffRow[] | undefined,
  );
  const stageSteps = INQUIRY_STEPS.map((definition, index) => ({
    ...definition,
    state: index < activeIndex ? "done" : index === activeIndex ? "current" : "next",
  }));

  return (
    <Shell
      title="ثبت درخواست متقاضی"
      subtitle="مسیر کامل درخواست از پذیرش تا قرارداد؛ هر مرحله فقط با اقدام صریح مسئول همان مرحله جلو می‌رود."
      error={error}
      loading={loading && !Object.keys(data).length}
      onReload={reload}
    >
      {lastCase && !inquiryId ? (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong>ادامهٔ پروندهٔ اخیر</strong>
            <p className="text-xs text-muted-foreground">{lastCase.code} · {lastCase.contactName} · {lastCase.stageLabel}</p>
          </div>
          <div className="flex gap-2">
            <Btn onClick={() => navigate("crm-inquiry-register", lastCase.id)}>ادامه</Btn>
            <Btn color="light" onClick={() => { clearLastInquiryCase(userKey); setLastCase(null); }}>بستن</Btn>
          </div>
        </Card>
      ) : null}
      {message ? <div role="status" className="mb-4 rounded-xl bg-secondary px-4 py-3 text-sm">{message}</div> : null}
      <div className="mb-4 grid gap-2 md:grid-cols-3 xl:grid-cols-5">
        {stageSteps.map((definition) => (
          <div key={definition.key} className={`rounded-xl border p-3 text-xs ${definition.state === "current" ? "border-emerald-600 bg-emerald-50/60 dark:bg-emerald-500/12" : definition.state === "done" ? "bg-secondary" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">{definition.label}</span>
              <span className="text-muted-foreground">{definition.state === "done" ? "انجام‌شده" : definition.state === "current" ? "مرحلهٔ جاری" : "بعدی"}</span>
            </div>
            <p className="mt-1 text-muted-foreground">{definition.owner}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">{INQUIRY_STEPS[activeIndex].label}</h2>
              <Badge label={guidance.canAct ? "اقدام شما در این مرحله مجاز است" : "در انتظار اقدام مسئول مرحله"} variant={guidance.canAct ? "success" : "muted"} />
            </div>
            <p className="rounded-xl bg-secondary px-3 py-2 text-sm">{guidance.headline}</p>
            <p className="text-xs text-muted-foreground">{guidance.body}</p>
            {inquiry ? (
              <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <span>کد: {inquiry.code}</span>
                <span>متقاضی: {inquiry.contact_name}</span>
                <span>مسئول: {inquiry.assigned_to_name || "تعیین نشده"}</span>
                <span>مسئول مرحله: {inquiry.stage_responsible || "—"}</span>
              </div>
            ) : null}
          </Card>

          {step === "lead" ? (
            <Card className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                {/* The same searchable person picker as the rest of the panel: the CRM keeps every
                    record separately, so a plain list repeated a person once per stored copy and
                    gave no way to search by name, number or national code. */}
                <ContactCombobox
                  label="متقاضی"
                  required
                  loading={loading && !contacts.length}
                  contacts={contacts as ContactComboboxRow[]}
                  value={createForm.contact}
                  onChange={(next) => updateCreate({ contact: next })}
                  placeholder="انتخاب متقاضی از اشخاص CRM…"
                />
                <Field label="رنج مسئول">
                  <select value={createForm.sales_range} onChange={(event) => updateCreate({ sales_range: event.target.value })} className={inputCls}>
                    <option value="">رنج پیش‌فرض من</option>
                    {scopes.filter((scope) => scope.is_active !== false).map((scope) => <option key={scope.id} value={scope.id}>{scope.name}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="شرح اولیهٔ درخواست">
                <textarea rows={3} value={createForm.description} onChange={(event) => updateCreate({ description: event.target.value })} className={inputCls} />
              </Field>
              <Btn onClick={() => void run("درخواست ثبت شد.", submitCreate)} disabled={!createForm.contact || busy}>ثبت درخواست و ادامه</Btn>
            </Card>
          ) : null}

          {step === "reception" && inquiry ? (
            <Card className="space-y-3">
              <p className="text-sm">پذیرش درخواست توسط مدیر رنج انجام می‌شود و پس از آن ارجاع به مشاور مسئول فعال می‌شود.</p>
              <Btn disabled={!isManager || busy} onClick={() => requestConfirm("پذیرش درخواست", () => postAction(`/crm/api/inquiries/${inquiry.id}/accept_lead/`, { version: inquiry.version }))}>پذیرش درخواست</Btn>
            </Card>
          ) : null}

          {step === "assignment" && inquiry ? (
            <Card className="space-y-3">
              <ConsultantCombobox
                label="مشاور مسئول"
                required
                consultants={candidateUsers}
                allowedRoles={["AGENT", "RANGE_MANAGER", "ADMIN"]}
                loading={loading && !candidateUsers.length}
                value={assignForm.assigned_to}
                onChange={(value) => setAssignForm((current) => ({ ...current, assigned_to: value }))}
              />
              <JalaliDateTimeInput name="due_at" label="مهلت پیگیری" value={assignForm.due_at} onChange={(value) => setAssignForm((current) => ({ ...current, due_at: value }))} required />
              <Btn
                disabled={!isManager || !assignForm.assigned_to || !assignForm.due_at || busy}
                onClick={() => requestConfirm("ارجاع درخواست", () => postAction(`/crm/api/inquiries/${inquiry.id}/assign/`, { assigned_to: Number(assignForm.assigned_to), due_at: assignForm.due_at, version: inquiry.version }))}
              >
                ثبت ارجاع
              </Btn>
            </Card>
          ) : null}

          {step === "acceptance" && inquiry ? (
            <Card className="space-y-3">
              <p className="text-sm">ارجاع به شما رسیده است. با پذیرش، ثبت نیاز و تطبیق فعال می‌شود؛ رد ارجاع دلیل الزامی دارد.</p>
              <div className="flex flex-wrap gap-2">
                <Btn
                  disabled={String(inquiry.assigned_to) !== String(currentUserId) || busy}
                  onClick={() => requestConfirm("پذیرش ارجاع", () => postAction(`/crm/api/inquiries/${inquiry.id}/accept_assignment/`, { version: inquiry.version }))}
                >
                  پذیرش ارجاع
                </Btn>
                <Btn color="light" onClick={() => setRejectReason("")}>درخواست رد</Btn>
              </div>
              <Field label="دلیل رد ارجاع">
                <input value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} className={inputCls} />
              </Field>
              <Btn
                color="light"
                disabled={!rejectReason.trim() || busy}
                onClick={() => requestConfirm("رد ارجاع", () => postAction(`/crm/api/inquiries/${inquiry.id}/reject_assignment/`, { reason: rejectReason.trim(), version: inquiry.version }))}
              >
                ثبت رد ارجاع
              </Btn>
            </Card>
          ) : null}

          {step === "needs" && inquiry ? (
            <Card className="space-y-3">
              <NeedsEditor rows={needsRows} onChange={setNeedsRows} dealTypes={dealTypes} districts={districts} propertyTypes={propertyTypes} />
              <Btn disabled={busy} onClick={() => requestConfirm("ثبت نیاز و بودجه", submitNeeds)}>{busy ? "در حال ذخیره…" : "ثبت نیاز و بودجه"}</Btn>
            </Card>
          ) : null}

          {step === "matching" && inquiry ? (
            <div className="space-y-3">
              <Card className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong>تطبیق فایل‌ها</strong>
                  <p className="text-xs text-muted-foreground">تطبیق فقط خواندنی است و هیچ معرفی یا پرونده‌ای نمی‌سازد.</p>
                </div>
                <Badge label={`${formatFaNumber(matches.length)} فایل بررسی شد`} variant="info" />
              </Card>
              <MatchPanel
                matches={matches}
                offerable={can("introduction.manage")}
                onIntroduce={(match) => { setIntroTarget(match); setIntroOpen(true); }}
                busy={busy}
              />
            </div>
          ) : null}

          {step === "viewings" && inquiry ? (
            <Card className="space-y-3">
              <Field label="معرفی مبنا">
                <select value={viewingForm.introduction} onChange={(event) => setViewingForm({ ...viewingForm, introduction: event.target.value })} className={inputCls}>
                  <option value="">انتخاب معرفی</option>
                  {introductions.filter((item) => item.status === "OPEN").map((item) => <option key={item.id} value={item.id}>{item.property_file_title}</option>)}
                </select>
              </Field>
              <JalaliDateTimeInput name="scheduled_at" label="زمان بازدید" value={viewingForm.scheduled_at} onChange={(value) => setViewingForm((current) => ({ ...current, scheduled_at: value }))} required />
              <Btn
                disabled={!selectedIntro || !viewingForm.scheduled_at || busy}
                onClick={() => requestConfirm("ثبت بازدید", () => postAction("/crm/api/viewings/", { introduction: Number(viewingForm.introduction), scheduled_at: viewingForm.scheduled_at, notes: viewingForm.notes }))}
              >
                ثبت زمان بازدید
              </Btn>
              <div className="space-y-2">
                {scopedViewings.map((viewing) => (
                  <div key={viewing.id} className="rounded-xl border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{new Date(viewing.scheduled_at).toLocaleString("fa-IR")} · {viewing.result || "PENDING"}</span>
                      {!viewing.completed_at ? (
                        <div className="flex flex-wrap gap-2">
                          <Btn color="light" onClick={() => requestConfirm("ثبت نتیجهٔ بازدید", () => postAction(`/crm/api/viewings/${viewing.id}/complete/`, { result: "INTERESTED", notes: viewingResult[viewing.id] || "" }))}>مورد پسند</Btn>
                          <Btn color="light" onClick={() => requestConfirm("ثبت نتیجهٔ بازدید", () => postAction(`/crm/api/viewings/${viewing.id}/complete/`, { result: "NOT_INTERESTED", notes: viewingResult[viewing.id] || "" }))}>بدون تمایل</Btn>
                        </div>
                      ) : <Badge label="بسته‌شده" variant="muted" />}
                    </div>
                    {!viewing.completed_at ? (
                      <input value={viewingResult[viewing.id] || ""} onChange={(event) => setViewingResult({ ...viewingResult, [viewing.id]: event.target.value })} placeholder="یادداشت نتیجه" className={`${inputCls} mt-2`} />
                    ) : null}
                  </div>
                ))}
                {!scopedViewings.length ? <p className="text-sm text-muted-foreground">برای این درخواست بازدیدی ثبت نشده است.</p> : null}
              </div>
            </Card>
          ) : null}

          {step === "negotiation" && inquiry ? (
            <Card className="space-y-3">
              <Field label="بازدید مبنا">
                <select value={dealForm.viewing} onChange={(event) => setDealForm({ viewing: event.target.value })} className={inputCls}>
                  <option value="">انتخاب بازدید</option>
                  {scopedViewings.filter((item) => item.completed_at && item.result === "INTERESTED").map((item) => <option key={item.id} value={item.id}>{new Date(item.scheduled_at).toLocaleString("fa-IR")}</option>)}
                </select>
              </Field>
              <Btn
                disabled={!dealForm.viewing || busy}
                onClick={() => requestConfirm("شروع مذاکره", () => postAction("/crm/api/deals/", { viewing: Number(dealForm.viewing) }))}
              >
                شروع مذاکره
              </Btn>
              <div className="space-y-2">
                {deals.map((deal) => (
                  <div key={deal.id} className="rounded-xl border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{deal.property_file_title} · {deal.stage_label || deal.stage}</span>
                      <div className="flex flex-wrap gap-2">
                        {deal.stage === "NEGOTIATION" ? <Btn color="light" onClick={() => requestConfirm("ثبت توافق", () => postAction(`/crm/api/deals/${deal.id}/succeed/`, { result_notes: "", version: deal.version }))}>نتیجهٔ موفق</Btn> : null}
                        {["NEGOTIATION", "AGREED"].includes(deal.stage) ? <Btn color="light" onClick={() => requestConfirm("ثبت عدم توافق", () => postAction(`/crm/api/deals/${deal.id}/close/`, { closure_reason: closeReason || "عدم توافق", version: deal.version }))}>عدم توافق</Btn> : null}
                      </div>
                    </div>
                  </div>
                ))}
                {deals.some((deal) => ["NEGOTIATION", "AGREED"].includes(deal.stage)) ? (
                  <Field label="دلیل عدم توافق">
                    <input value={closeReason} onChange={(event) => setCloseReason(event.target.value)} className={inputCls} />
                  </Field>
                ) : null}
              </div>
            </Card>
          ) : null}

          {step === "contract" && inquiry ? (
            <Card className="space-y-3">
              <p className="text-sm">تنظیم و امضای قرارداد فقط توسط مدیر کل انجام می‌شود.</p>
              {contracts.map((contract) => (
                <div key={contract.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm">
                  <span>{contract.contract_number} · {contract.status}</span>
                  <Btn color="light" onClick={() => navigate("crm-contracts", contract.id)} disabled={!isGeneralManager}>مشاهدهٔ قرارداد</Btn>
                </div>
              ))}
              {!contracts.length && deals.some((deal) => deal.stage === "AGREED") ? (
                <p className="text-xs text-muted-foreground">مذاکره در وضعیت توافق است؛ مدیر کل باید قرارداد را بسازد.</p>
              ) : null}
              {!contracts.length && !deals.some((deal) => deal.stage === "AGREED") ? <p className="text-xs text-muted-foreground">هنوز مذاکرهٔ توافق‌شده‌ای برای این درخواست ثبت نشده است.</p> : null}
            </Card>
          ) : null}

          {!inquiry && step === "lead" ? null : null}
        </div>

        <Card className="space-y-3">
          <h2 className="font-bold">اقدام جاری</h2>
          {confirmAction ? (
            <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/35 dark:bg-amber-500/12 text-sm">
              <p>آیا «{confirmAction.label}» را تأیید می‌کنید؟ این اقدام قابل بازگشت نیست.</p>
              <div className="flex gap-2">
                <Btn onClick={() => void run("انجام شد.", confirmAction.run)} disabled={busy}>تأیید و ثبت</Btn>
                <Btn color="light" onClick={() => setConfirmAction(null)}>انصراف</Btn>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">اقدام اصلی این مرحله در ستون کنار نمایش داده می‌شود. برای ثبت، ابتدا آن را تأیید کنید.</p>
          )}
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>مرحله بعد: {INQUIRY_STEPS[Math.min(activeIndex + 1, INQUIRY_STEPS.length - 1)].label}</p>
            <p>همهٔ اقدام‌ها نسخهٔ پرونده را بررسی می‌کنند؛ اگر پرونده تغییر کرده باشد، صفحه تازه می‌شود.</p>
          </div>
          <div className="flex gap-2">
            <Btn color="light" onClick={() => navigate("crm-inquiries", inquiryId || undefined)}><ArrowRight size={16} /> فهرست درخواست‌ها</Btn>
            {inquiryId ? <Btn color="light" onClick={() => navigate("crm-introductions")}><ArrowLeft size={16} /> معرفی‌ها</Btn> : null}
          </div>
          {inquiry ? (
            <div className="rounded-xl border p-3 text-xs">
              <div className="flex justify-between"><span>مبلغ فایل‌های منطبق</span><span>{formatFaMoney(matches[0]?.sale_price)}</span></div>
              <div className="mt-1 flex justify-between"><span>بیشترین درصد تطبیق</span><span>{formatFaNumber(matches[0]?.match_percent ?? 0)}٪</span></div>
            </div>
          ) : null}
        </Card>
      </div>
      <IntroductionModal
        open={introOpen}
        match={introTarget}
        busy={busy}
        onClose={() => { setIntroOpen(false); setIntroTarget(null); }}
        onConfirm={() => { if (introTarget) void introduce(introTarget); }}
      />
    </Shell>
  );
}
