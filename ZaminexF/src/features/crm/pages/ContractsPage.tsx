import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../../shared/components/ui/Badge";
import { EmptyState } from "../../../shared/components/ui/EmptyState";
import { Tabs } from "../../../shared/components/ui/Foundation";
import { JalaliDateInput } from "../../../shared/components/ui/JalaliDateInput";
import { usePermissions } from "../../../shared/lib/permissions";
import { Btn, Card, Field, SearchBar, Shell, inputCls } from "../components/CrmUIKit";
import { post, postForm } from "../lib/crmApi";
import { useLoad } from "../lib/useCrmLoad";
import { contractFinancialSummary, contractMissingItems, formatFaMoney, formatFaNumber, validateContractTerms, type ContractRecord, type ContractTermsSchema } from "../lib/commercialDomain";
import type { CrmNavigate, Row } from "../types";

const CONTRACT_TABS = [
  { key: "info", label: "اطلاعات قرارداد" },
  { key: "parties", label: "طرفین" },
  { key: "subject", label: "موضوع قرارداد" },
  { key: "financial", label: "شرایط مالی" },
  { key: "dates", label: "تاریخ‌ها و تعهدات" },
  { key: "documents", label: "اسناد و پیوست‌ها" },
  { key: "review", label: "بازبینی نهایی" },
];

const CONTRACT_STATUS: Record<string, string> = {
  DRAFT: "پیش‌نویس",
  SIGNING: "در حال امضا",
  FINALIZED: "قطعی",
};

const PARTY_ROLES: Record<string, string> = {
  BUYER: "خریدار",
  SELLER: "فروشنده",
  TENANT: "مستأجر",
  LANDLORD: "موجر",
  REPRESENTATIVE: "نماینده",
};

export function Contracts({ csrfToken, navigate, role, recordId }: { csrfToken: string; navigate: CrmNavigate; role: string; recordId?: string | null }) {
  const { can } = usePermissions();
  const isGm = role === "admin";
  const canViewQueue = isGm || can("finance.view");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("info");
  const [selectedId, setSelectedId] = useState<string | null>(recordId ? String(recordId) : null);
  const [terms, setTerms] = useState<Record<string, unknown>>({});
  const [termErrors, setTermErrors] = useState<Record<string, string>>({});
  const [party, setParty] = useState({ contact: "", party_role: "BUYER" });
  const [amendment, setAmendment] = useState({ reason: "", effective_at: "" });
  const [uploadType, setUploadType] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (recordId) setSelectedId(String(recordId));
  }, [recordId]);

  const query = useMemo(() => `/crm/api/contracts/?search=${encodeURIComponent(search.trim())}&page_size=100`, [search]);
  const urls = useMemo(() => (canViewQueue ? [query] : []), [query, canViewQueue]);
  const gmUrls = useMemo(() => (isGm ? ["/crm/api/deals/?stage=AGREED&page_size=100", "/crm/api/deal-type-versions/?page_size=100", "/crm/api/contacts/?page_size=200"] : []), [isGm]);
  const { data, error, loading, reload } = useLoad([...urls, ...gmUrls], csrfToken);
  const contracts: ContractRecord[] = (data[query] || []) as ContractRecord[];
  const agreedDeals: Row[] = isGm ? data[gmUrls[0]] || [] : [];
  const versions: Row[] = isGm ? data[gmUrls[1]] || [] : [];
  const contacts: Row[] = isGm ? data[gmUrls[2]] || [] : [];
  const selected = contracts.find((item) => String(item.id) === String(selectedId)) || null;
  const version = selected ? versions.find((item) => String(item.id) === String(selected.deal_type_version)) : null;
  const schema = (version?.terms_schema as ContractTermsSchema | undefined) || null;

  useEffect(() => {
    if (!selected) return;
    setTerms((selected.terms_snapshot || {}) as Record<string, unknown>);
    setTermErrors({});
    setAmendment({ reason: "", effective_at: "" });
  }, [selected?.id, selected?.version]);

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

  async function upload(fileForm: HTMLFormElement) {
    if (!selected) return;
    setBusy(true);
    try {
      await postForm(csrfToken, `/crm/api/contracts/${selected.id}/add_attachment/`, new FormData(fileForm));
      fileForm.reset();
      setMessage("پیوست قرارداد بارگذاری شد.");
      await reload();
    } catch (errorValue) {
      setMessage(errorValue instanceof Error ? errorMessage(errorValue) : "بارگذاری پیوست ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  function errorMessage(value: unknown) {
    return value instanceof Error ? value.message : "خطای نامشخص";
  }

  function saveTerms() {
    if (!selected) return;
    const validation = validateContractTerms(schema, terms);
    setTermErrors(validation.errors);
    if (!validation.valid) {
      setMessage("شرایط مالی کامل نیست؛ موارد ناقص را اصلاح کنید.");
      return;
    }
    void act(`/crm/api/contracts/${selected.id}/save_terms/`, { terms, version: selected.version }, "شرایط قرارداد ذخیره شد.");
  }

  if (!canViewQueue) {
    return (
      <Shell title="قراردادها">
        <Card>دسترسی قرارداد، امضا و اصلاحیه فقط برای مدیر کل است.</Card>
      </Shell>
    );
  }

  const missing = selected ? contractMissingItems(selected, schema) : [];
  const signedCount = selected?.parties?.filter((item) => item.signature_status === "SIGNED").length || 0;
  const canFinalize = isGm && selected && selected.status !== "FINALIZED" && missing.length === 0;

  return (
    <Shell
      title={isGm ? "قراردادها" : "کارتابل قرارداد"}
      subtitle={isGm ? "تنظیم شرایط، ثبت امضا و قطعی‌سازی فقط در اختیار مدیر کل است." : "در این کارتابل فقط شماره، مبلغ و وضعیت قرارداد نمایش داده می‌شود."}
      error={error}
      loading={loading && !Object.keys(data).length}
      onReload={reload}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <SearchBar value={search} onChange={setSearch} placeholder="جست‌وجو بر اساس شماره، متقاضی یا وضعیت…" flush />
        {isGm ? <Badge label={`${formatFaNumber(agreedDeals.length)} مذاکرهٔ آمادهٔ قرارداد`} variant="info" /> : null}
      </div>
      {message ? <div role="status" className="mb-4 rounded-xl bg-secondary px-4 py-3 text-sm">{message}</div> : null}
      {isGm && agreedDeals.length ? (
        <Card className="mb-4 space-y-2">
          <h2 className="font-bold">ساخت قرارداد از مذاکرهٔ توافق‌شده</h2>
          <div className="flex flex-wrap gap-2">
            {agreedDeals.map((deal) => (
              <Btn key={deal.id} color="light" disabled={busy} onClick={() => act("/crm/api/contracts/", { deal: deal.id }, "قرارداد ساخته شد.")}>
                {deal.inquiry_code} · {deal.property_file_title}
              </Btn>
            ))}
          </div>
        </Card>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[1fr_1.6fr]">
        <div className="space-y-3">
          {contracts.map((item) => (
            <Card key={item.id} className={`cursor-pointer space-y-2 hover:border-emerald-500 ${String(item.id) === String(selectedId) ? "border-emerald-600" : ""}`}>
              <button type="button" className="w-full text-right" onClick={() => setSelectedId(String(item.id))}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>{item.contract_number}</strong>
                  <Badge label={CONTRACT_STATUS[item.status] || item.status} variant={item.status === "FINALIZED" ? "success" : item.status === "SIGNING" ? "info" : "muted"} />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {item.inquiry_code ? `درخواست ${item.inquiry_code}` : "درخواست مرتبط"} · {item.status === "FINALIZED" ? `مبلغ: ${formatFaMoney(item.sale_price || item.deposit)}` : "شرایط در دسترس مدیر کل"}
                </div>
              </button>
            </Card>
          ))}
          {!contracts.length && !loading ? <EmptyState title="قراردادی یافت نشد" description={isGm ? "از مذاکرهٔ توافق‌شده قرارداد بسازید." : "قراردادی در کارتابل شما نیست."} /> : null}
        </div>
        <Card className="space-y-3">
          {selected ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">{selected.contract_number}</div>
                  <h2 className="text-lg font-bold">{selected.contact_name || selected.property_title || "قرارداد"}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge label={CONTRACT_STATUS[selected.status] || selected.status} variant={selected.status === "FINALIZED" ? "success" : "info"} />
                  <Btn color="light" onClick={() => navigate("crm-deals", selected.deal)}>پروندهٔ مذاکره</Btn>
                </div>
              </div>
              {!isGm ? (
                <dl className="grid gap-2 rounded-xl border p-3 text-sm sm:grid-cols-2">
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">مبلغ</dt><dd>{formatFaMoney(selected.sale_price)}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">ودیعه</dt><dd>{formatFaMoney(selected.deposit)}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">اجارهٔ ماهانه</dt><dd>{formatFaMoney(selected.monthly_rent)}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">وضعیت</dt><dd>{CONTRACT_STATUS[selected.status] || selected.status}</dd></div>
                </dl>
              ) : (
                <>
                  <Tabs value={tab} tabs={CONTRACT_TABS} onChange={setTab} />
                  {tab === "info" ? (
                    <dl className="grid gap-2 text-sm sm:grid-cols-2">
                      <div className="rounded-xl bg-secondary px-3 py-2">شماره: {selected.contract_number}</div>
                      <div className="rounded-xl bg-secondary px-3 py-2">وضعیت: {CONTRACT_STATUS[selected.status] || selected.status}</div>
                      <div className="rounded-xl bg-secondary px-3 py-2">درخواست: {selected.inquiry_code || "—"}</div>
                      <div className="rounded-xl bg-secondary px-3 py-2">ملک: {selected.property_title || "—"}</div>
                      <div className="rounded-xl bg-secondary px-3 py-2">نوع معامله: {selected.deal_type_name || "—"}</div>
                      <div className="rounded-xl bg-secondary px-3 py-2">نسخه: {formatFaNumber(selected.version)}</div>
                      <div className="rounded-xl bg-secondary px-3 py-2">تاریخ اثر: {selected.effective_at ? new Date(selected.effective_at).toLocaleDateString("fa-IR") : "ثبت نشده"}</div>
                      <div className="rounded-xl bg-secondary px-3 py-2">قطعی‌سازی: {selected.finalized_at ? new Date(selected.finalized_at).toLocaleString("fa-IR") : "نشده"}</div>
                    </dl>
                  ) : null}
                  {tab === "parties" ? (
                    <div className="space-y-2">
                      {(selected.parties || []).map((item) => (
                        <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 text-sm">
                          <span>{item.contact_name} · {PARTY_ROLES[item.party_role] || item.party_role}</span>
                          <Badge label={item.signature_status === "SIGNED" ? "امضا شده" : "در انتظار امضا"} variant={item.signature_status === "SIGNED" ? "success" : "warning"} />
                        </div>
                      ))}
                      {selected.status !== "FINALIZED" ? (
                        <div className="grid gap-2 sm:grid-cols-3">
                          <select value={party.contact} onChange={(event) => setParty({ ...party, contact: event.target.value })} className={inputCls}>
                            <option value="">افزودن طرف</option>
                            {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.full_name}</option>)}
                          </select>
                          <select value={party.party_role} onChange={(event) => setParty({ ...party, party_role: event.target.value })} className={inputCls}>
                            {Object.entries(PARTY_ROLES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                          <Btn color="light" disabled={!party.contact || busy} onClick={() => act(`/crm/api/contracts/${selected.id}/parties/`, { contact: Number(party.contact), party_role: party.party_role }, "طرف قرارداد افزوده شد.")}>افزودن طرف</Btn>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {tab === "subject" ? (
                    <div className="space-y-2 text-sm">
                      <div className="rounded-xl bg-secondary px-3 py-2">نوع معامله: {selected.deal_type_name || "—"}</div>
                      <div className="rounded-xl bg-secondary px-3 py-2">خانواده: {version?.family || "—"}</div>
                      <div className="rounded-xl bg-secondary px-3 py-2">نسخهٔ نوع معامله: {formatFaNumber(selected.deal_type_version)}</div>
                      {selected.property_title ? <div className="rounded-xl bg-secondary px-3 py-2">ملک: {selected.property_title}</div> : null}
                    </div>
                  ) : null}
                  {tab === "financial" ? (
                    <div className="space-y-2">
                      {selected.status === "FINALIZED" ? (
                        <dl className="grid gap-2 text-sm sm:grid-cols-2">
                          {contractFinancialSummary(selected).map((row) => (
                            <div key={row.label} className="flex justify-between gap-2 rounded-xl bg-secondary px-3 py-2"><dt className="text-muted-foreground">{row.label}</dt><dd>{row.value}</dd></div>
                          ))}
                        </dl>
                      ) : (
                        <>
                          {(schema?.fields || []).map((field) => (
                            <Field key={field.key} label={`${field.label}${field.unit ? ` (${field.unit})` : ""}`}>
                              <input
                                aria-label={field.label}
                                value={terms[field.key] === null || terms[field.key] === undefined ? "" : String(terms[field.key])}
                                onChange={(event) => setTerms({ ...terms, [field.key]: event.target.value })}
                                className={inputCls}
                              />
                              {termErrors[field.key] ? <span className="mt-1 block text-xs text-red-600 dark:text-red-300">{termErrors[field.key]}</span> : null}
                            </Field>
                          ))}
                          {!schema?.fields?.length ? <p className="text-sm text-muted-foreground">تعریف شرایط برای این نسخهٔ نوع معامله ثبت نشده است.</p> : null}
                          <Btn disabled={busy || selected.status === "FINALIZED"} onClick={saveTerms}>ذخیرهٔ شرایط مالی</Btn>
                          <p className="text-xs text-muted-foreground">پس از ثبت اولین امضا، تغییر شرایط مالی ممکن نیست.</p>
                        </>
                      )}
                    </div>
                  ) : null}
                  {tab === "dates" ? (
                    <div className="space-y-2 text-sm">
                      <Field label="تاریخ اثر">
                        <JalaliDateInput label="تاریخ اثر" value={selected.effective_at ? new Date(selected.effective_at).toISOString().slice(0, 10) : ""} onChange={() => undefined} />
                      </Field>
                      <div className="rounded-xl bg-secondary px-3 py-2">تاریخ تکمیل امضاها: {selected.signed_at ? new Date(selected.signed_at).toLocaleString("fa-IR") : "ثبت نشده"}</div>
                      <div className="rounded-xl bg-secondary px-3 py-2">تاریخ قطعی‌سازی: {selected.finalized_at ? new Date(selected.finalized_at).toLocaleString("fa-IR") : "ثبت نشده"}</div>
                      {(selected.terms_history || []).length ? <p className="text-xs text-muted-foreground">{formatFaNumber((selected.terms_history || []).length)} نسخهٔ پیشین شرایط نگه‌داری شده است.</p> : null}
                    </div>
                  ) : null}
                  {tab === "documents" ? (
                    <div className="space-y-2">
                      {(selected.attachments || []).map((item: Row) => (
                        <a key={item.id} href={item.file} className="block rounded-xl border p-2 text-sm text-primary underline" rel="noreferrer">
                          {item.filename || item.document_type || "دریافت فایل قرارداد"}
                        </a>
                      ))}
                      {!(selected.attachments || []).length ? <p className="text-sm text-muted-foreground">فایلی بارگذاری نشده است.</p> : null}
                      {selected.status !== "FINALIZED" ? (
                        <form
                          onSubmit={(event) => { event.preventDefault(); void upload(event.currentTarget); }}
                          className="grid gap-2 sm:grid-cols-3"
                        >
                          <input value={uploadType} onChange={(event) => setUploadType(event.target.value)} name="document_type" placeholder="نوع مدرک" className={inputCls} />
                          <input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required className={`${inputCls} sm:col-span-2`} />
                          <div className="sm:col-span-3"><Btn type="submit" color="light" disabled={busy}>بارگذاری فایل</Btn></div>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                  {tab === "review" ? (
                    <div className="space-y-3">
                      <div className="rounded-xl border p-3">
                        <h3 className="font-bold">بازبینی پیش از امضا</h3>
                        {missing.length ? (
                          <ul className="mt-2 space-y-1 text-sm text-amber-700 dark:text-amber-300">
                            {missing.map((item) => <li key={item}>• {item}</li>)}
                          </ul>
                        ) : <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">همهٔ موارد الزامی کامل است.</p>}
                        <p className="mt-2 text-xs text-muted-foreground">{formatFaNumber(signedCount)} از {formatFaNumber((selected.parties || []).length)} طرف امضا کرده‌اند.</p>
                      </div>
                      <div className="space-y-2">
                        {(selected.parties || []).map((item) => (
                          <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 text-sm">
                            <span>{item.contact_name} · {PARTY_ROLES[item.party_role] || item.party_role}</span>
                            {item.signature_status === "SIGNED" ? <Badge label="امضا شده" variant="success" /> : (
                              <Btn color="light" disabled={busy} onClick={() => act(`/crm/api/contracts/${selected.id}/sign/`, { contract_party: item.id }, "امضای دستی ثبت شد.")}>ثبت امضای دستی</Btn>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Btn disabled={!canFinalize || busy} onClick={() => act(`/crm/api/contracts/${selected.id}/finalize/`, {}, "قرارداد قطعی شد و پرونده بسته شد.")}>قطعی‌سازی قرارداد</Btn>
                        <Btn color="light" onClick={() => navigate("crm-finance")}>مطالبهٔ کمیسیون</Btn>
                      </div>
                      <div className="space-y-2 border-t pt-3">
                        <h3 className="font-bold">اصلاحیه‌ها</h3>
                        {(selected.amendments || []).map((item: Row) => (
                          <div key={item.id} className="rounded-xl border p-2 text-sm">اصلاحیه {item.amendment_number} · {item.reason}</div>
                        ))}
                        {selected.status === "FINALIZED" ? (
                          <>
                            <Field label="دلیل اصلاحیه"><input value={amendment.reason} onChange={(event) => setAmendment({ ...amendment, reason: event.target.value })} className={inputCls} /></Field>
                            <JalaliDateInput
                              label="تاریخ اثر"
                              value={amendment.effective_at}
                              onChange={(value) => setAmendment({ ...amendment, effective_at: value })}
                            />
                            <Btn
                              color="light"
                              disabled={!amendment.reason.trim() || !amendment.effective_at || busy}
                              onClick={() => act(`/crm/api/contracts/${selected.id}/amendments/`, { reason: amendment.reason.trim(), effective_at: amendment.effective_at, new_terms_snapshot: selected.terms_snapshot || {} }, "اصلاحیه ثبت شد؛ سند قبلی بازنویسی نمی‌شود.")}
                            >
                              ثبت اصلاحیه
                            </Btn>
                          </>
                        ) : <p className="text-xs text-muted-foreground">اصلاحیه فقط پس از قطعی‌سازی قرارداد ثبت می‌شود.</p>}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">یک قرارداد را انتخاب کنید.</p>
          )}
        </Card>
      </div>
    </Shell>
  );
}
