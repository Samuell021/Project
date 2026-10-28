import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Banknote, CheckCircle2, Loader2, Percent, Plus, Receipt, Search, Undo2 } from "lucide-react";
import { Badge } from "../../../shared/components/ui/Badge";
import { EmptyState } from "../../../shared/components/ui/EmptyState";
import { Skeleton } from "../../../shared/components/ui/Foundation";
import { JalaliDateInput } from "../../../shared/components/ui/JalaliDateInput";
import { usePermissions } from "../../../shared/lib/permissions";
import { jalaliToGregorianISO, toJalaliISO } from "../../../shared/lib/jdate";
import { usePageQuery } from "../../../shared/lib/pageQuery";
import { Btn, Card, Field, Shell, inputCls } from "../components/CrmUIKit";
import { post } from "../lib/crmApi";
import { useLoad } from "../lib/useCrmLoad";
import {
  claimStateLabel,
  moneyOrUnknown,
  numberOrUnknown,
  paymentTone,
  policySignature,
  type FinanceClaim,
  type FinanceContractDetail,
  type FinanceContractRow,
  type FinanceOverview,
  type FinancePayment,
  type FinanceShare,
} from "../lib/financeDomain";
import type { Row } from "../types";

const CLAIM_TABS = [
  { key: "claims", label: "مطالبات" },
  { key: "payments", label: "وجوه و تخصیص" },
  { key: "policies", label: "سیاست کمیسیون" },
];

function statusTone(status: string): "success" | "warning" | "danger" | "default" {
  if (status === "PAID" || status === "FINALIZED") return "success";
  if (status === "PARTIALLY_PAID" || status === "APPROVED") return "warning";
  if (status === "REVERSED") return "danger";
  return "default";
}

export function Finance({ csrfToken }: { csrfToken: string }) {
  const { query, update } = usePageQuery();
  const { can } = usePermissions();
  const [search, setSearch] = useState(query.get("search") || "");
  const [tab, setTab] = useState(query.get("tab") || "claims");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptDate, setReceiptDate] = useState(toJalaliISO(new Date().toISOString()));
  const [receiptMethod, setReceiptMethod] = useState("");
  const [shareBeneficiary, setShareBeneficiary] = useState("");
  const [policyForm, setPolicyForm] = useState({ name: "", deal_type: "", version_number: "1", calculation_method: "PERCENT", value: "" });
  const [claimForm, setClaimForm] = useState({ debtor: "", policy: "", base: "", manual: "" });
  const [adjustForm, setAdjustForm] = useState<Record<number, { amount: string; reason: string }>>({});
  const [payForm, setPayForm] = useState<Record<number, string>>({});
  const selectedId = query.get("contract") || "";

  const listUrl = "/crm/api/finance/overview/";
  const urls = useMemo(
    () => [listUrl, "/crm/api/deal-types/?page_size=100", "/crm/api/staff/?page_size=200", ...(selectedId ? [`/crm/api/finance/contracts/${selectedId}/`] : [])],
    [selectedId],
  );
  const { data, error, loading, reload } = useLoad(urls, csrfToken);
  const overview = (data[listUrl] || { contracts: [], totals: { claimed: "0", received: "0", shares_paid: "0", outstanding: "0" }, claim_count: 0, payment_count: 0 }) as FinanceOverview;
  const dealTypes: Row[] = (data["/crm/api/deal-types/?page_size=100"] || []) as Row[];
  const staff: Row[] = (data["/crm/api/staff/?page_size=200"] || []) as Row[];
  const detail = (selectedId ? data[`/crm/api/finance/contracts/${selectedId}/`] : null) as FinanceContractDetail | null;

  const contracts = useMemo(() => {
    const term = search.trim();
    if (!term) return overview.contracts;
    return overview.contracts.filter((row) => `${row.contract_number} ${row.title} ${row.deal_type}`.includes(term));
  }, [overview.contracts, search]);

  useEffect(() => {
    update({ search: search.trim() || null, tab: tab === "claims" ? null : tab }, true);
  }, [search, tab, update]);

  useEffect(() => {
    if (!detail) return;
    setClaimForm({
      debtor: detail.debtor_options[0] ? String(detail.debtor_options[0].contact) : "",
      policy: detail.policies.find((policy) => policy.status === "PUBLISHED")?.id ? String(detail.policies.find((policy) => policy.status === "PUBLISHED")?.id) : "",
      base: detail.contract.deal_value && detail.contract.deal_value !== "0" ? detail.contract.deal_value : "",
      manual: "",
    });
  }, [detail?.contract.id, detail?.claims.length]);

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    setMessage("");
    try {
      await action();
      setMessage(success);
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "عملیات ناموفق بود.");
    } finally {
      setBusy("");
    }
  }

  const canManage = detail?.can_manage ?? can("finance.manage");

  function renderClaim(claim: FinanceClaim) {
    const adjust = adjustForm[claim.id] || { amount: "0", reason: "" };
    const receiptValue = payForm[claim.id] ?? claim.remaining_amount;
    return (
      <div key={claim.id} className="rounded-2xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 font-semibold">
              مطالبه #{numberOrUnknown(String(claim.id))}
              <Badge variant={statusTone(claim.status)} label={claimStateLabel(claim)} />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              بدهکار: طرف قرارداد #{numberOrUnknown(String(claim.debtor_contact ?? ""))} · سیاست: {claim.policy_version ? `نسخه #${numberOrUnknown(String(claim.policy_version))}` : "دستی"}
            </div>
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">مبلغ نهایی: </span>
            <strong>{moneyOrUnknown(claim.final_amount)}</strong>
          </div>
        </div>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-xl bg-surface-muted px-3 py-2">
            <div className="text-xs text-muted-foreground">محاسبه‌شده</div>
            <div className="font-semibold">{moneyOrUnknown(claim.calculated_amount)}</div>
          </div>
          <div className="rounded-xl bg-surface-muted px-3 py-2">
            <div className="text-xs text-muted-foreground">وصول‌شده</div>
            <div className="font-semibold text-emerald-700 dark:text-emerald-300">{moneyOrUnknown(claim.received_amount)}</div>
          </div>
          <div className="rounded-xl bg-surface-muted px-3 py-2">
            <div className="text-xs text-muted-foreground">مانده</div>
            <div className="font-semibold">{moneyOrUnknown(claim.remaining_amount)}</div>
          </div>
        </div>
        {claim.status === "PENDING" && canManage ? (
          <form
            className="mt-3 grid gap-2 rounded-xl border p-3 sm:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              run(`approve-${claim.id}`, () => post(csrfToken, `/crm/api/commissions/${claim.id}/approve/`, {
                adjustment_amount: adjust.amount || "0",
                adjustment_reason: adjust.reason,
              }), "مطالبه و سهم‌ها تأیید شد.");
            }}
          >
            <Field label="تعدیل مبلغ (اختیاری)">
              <input className={inputCls} type="number" value={adjust.amount} onChange={(event) => setAdjustForm({ ...adjustForm, [claim.id]: { ...adjust, amount: event.target.value } })} />
            </Field>
            <Field label="دلیل تعدیل">
              <input className={inputCls} value={adjust.reason} onChange={(event) => setAdjustForm({ ...adjustForm, [claim.id]: { ...adjust, reason: event.target.value } })} />
            </Field>
            <div className="flex items-end">
              <Btn type="submit" disabled={busy === `approve-${claim.id}`}>{busy === `approve-${claim.id}` ? "در حال ثبت…" : "تأیید مطالبه"}</Btn>
            </div>
          </form>
        ) : null}
        {canManage && claim.status !== "PENDING" && Number(claim.remaining_amount) > 0 ? (
          <div className="mt-3 rounded-xl border p-3">
            <div className="mb-3 text-sm font-medium">ثبت دریافت و تخصیص جزئی</div>
            {/* Two columns instead of four: the Jalali field carries its own `min-w-[13rem]` and
                used to spill out of a quarter-width track and over its neighbours. Every control
                shares one label/control rhythm, and the submit sits on the same baseline. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="مبلغ دریافت">
                <input className={inputCls} type="number" min="1" value={receiptValue} onChange={(event) => setPayForm({ ...payForm, [claim.id]: event.target.value })} />
              </Field>
              <Field label="روش">
                <input className={inputCls} value={receiptMethod} onChange={(event) => setReceiptMethod(event.target.value)} placeholder="کارت‌به‌کارت، نقد…" />
              </Field>
              <Field label="تاریخ دریافت (شمسی)">
                <JalaliDateInput value={receiptDate} onChange={setReceiptDate} />
              </Field>
              <div className="flex items-end">
                <Btn
                  disabled={busy === `pay-${claim.id}`}
                  onClick={() => run(`pay-${claim.id}`, () => post(csrfToken, "/crm/api/payments/", {
                    direction: "IN",
                    contact: claim.debtor_contact,
                    amount: receiptValue,
                    paid_at: receiptDate ? `${jalaliToGregorianISO(receiptDate)}T12:00:00+03:30` : new Date().toISOString(),
                    method: receiptMethod,
                    allocations: [{ commission: claim.id, amount: receiptValue }],
                  }), "دریافت ثبت و به مطالبه تخصیص یافت.")}
                >
                  {busy === `pay-${claim.id}` ? "در حال ثبت…" : "ثبت دریافت"}
                </Btn>
              </div>
            </div>
          </div>
        ) : null}
        <div className="mt-3 space-y-2">
          {claim.shares.length === 0 ? (
            <p className="text-xs text-muted-foreground">برای این مطالبه سهمی ثبت نشده است.</p>
          ) : claim.shares.map((share: FinanceShare) => (
            <div key={share.id} className="rounded-xl border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">سهم {share.beneficiary_name}{share.share_percent ? ` · ${share.share_percent}٪` : ""}</span>
                <span className="flex items-center gap-2">
                  <Badge variant={statusTone(share.status)} label={share.status_label} />
                  <span className="text-muted-foreground">مانده {moneyOrUnknown(share.remaining_amount)}</span>
                </span>
              </div>
              {canManage && share.beneficiary_type === "USER" && Number(share.remaining_amount) > 0 ? (
                <form
                  className="mt-2 flex flex-wrap items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const amount = String(form.get("amount") || "");
                    run(`share-${share.id}`, () => post(csrfToken, "/crm/api/payments/", {
                      direction: "OUT",
                      user: share.beneficiary_user,
                      amount,
                      paid_at: new Date().toISOString(),
                      allocations: [{ commission_share: share.id, amount }],
                    }), "پرداخت سهم ثبت شد.");
                  }}
                >
                  <Field label="پرداخت به سهم">
                    <input name="amount" className={inputCls} type="number" min="1" max={Number(share.remaining_amount)} defaultValue={Number(share.remaining_amount)} />
                  </Field>
                  <Btn type="submit" color="light" disabled={busy === `share-${share.id}`}>ثبت پرداخت</Btn>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderPayment(payment: FinancePayment) {
    const tone = paymentTone(payment);
    return (
      <div key={payment.id} className="rounded-xl border p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-medium">
            {payment.direction === "IN" ? <Banknote size={15} /> : <ArrowLeftRight size={15} />}
            {payment.direction === "IN" ? "دریافت" : "پرداخت"} {moneyOrUnknown(payment.amount)}
            {payment.reversal_of ? <Badge variant="muted" label={`سند برگشت #${numberOrUnknown(String(payment.reversal_of))}`} /> : null}
          </span>
          <span className="flex items-center gap-2">
            <Badge variant={tone === "negative" ? "danger" : tone === "positive" ? "success" : "default"} label={payment.status_label} />
            {canManage && payment.status === "CONFIRMED" && !payment.reversal_of ? (
              <Btn color="light" disabled={busy === `reverse-${payment.id}`} onClick={() => run(`reverse-${payment.id}`, () => post(csrfToken, `/crm/api/payments/${payment.id}/reverse/`), "سند برگشت ثبت شد.")}>
                <Undo2 size={13} /> برگشت
              </Btn>
            ) : null}
          </span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {payment.paid_at ? new Date(payment.paid_at).toLocaleString("fa-IR") : "زمان نامشخص"} · {payment.method || "روش نامشخص"} · مرجع {payment.reference_number || "—"}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          تخصیص‌ها: {payment.allocations.map((allocation) => `${allocation.commission ? `مطالبه #${numberOrUnknown(String(allocation.commission))}` : `سهم #${numberOrUnknown(String(allocation.commission_share ?? ""))}`} ← ${moneyOrUnknown(allocation.amount)}`).join(" · ") || "بدون تخصیص"}
        </div>
      </div>
    );
  }

  return (
    <Shell
      title="کمیسیون و وجوه"
      subtitle="ارزش معامله، مطالبه و وصول جدا نگه داشته می‌شوند؛ مبلغ نامشخص هرگز صفر نمایش داده نمی‌شود."
      error={error}
      loading={false}
      onReload={reload}
    >
      {loading && !overview.contracts.length ? <Skeleton label="در حال دریافت اطلاعات مالی" /> : null}
      <div role="status" aria-live="polite" className={message ? "mb-3 rounded-xl bg-surface-muted px-4 py-2 text-sm" : "sr-only"}>{message}</div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><div className="text-xs text-muted-foreground">مطالبه تأییدشده</div><div className="mt-1 text-xl font-bold">{moneyOrUnknown(overview.totals.claimed)}</div></Card>
        <Card><div className="text-xs text-muted-foreground">وصول</div><div className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-300">{moneyOrUnknown(overview.totals.received)}</div></Card>
        <Card><div className="text-xs text-muted-foreground">مانده وصول‌نشده</div><div className="mt-1 text-xl font-bold">{moneyOrUnknown(overview.totals.outstanding)}</div></Card>
        <Card><div className="text-xs text-muted-foreground">سهم پرداختی</div><div className="mt-1 text-xl font-bold">{moneyOrUnknown(overview.totals.shares_paid ?? "0")}</div></Card>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="finance-search">جست‌وجو در قراردادها</label>
        <div className="relative w-full max-w-md">
          <Search size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input id="finance-search" type="search" className={`${inputCls} pr-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="شماره قرارداد، عنوان فایل یا نوع معامله…" />
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,22rem)_1fr]">
        <Card className="h-fit">
          <h2 className="mb-3 text-sm font-bold">قراردادهای قطعی ({contracts.length.toLocaleString("fa-IR")})</h2>
          {contracts.length === 0 ? (
            <EmptyState icon={<Receipt size={22} />} title="قراردادی یافت نشد" description={search ? "عبارت جست‌وجو را تغییر دهید." : "با قطعی‌شدن قرارداد، مطالبه از همین صفحه ساخته می‌شود."} />
          ) : (
            <ul className="space-y-2">
              {contracts.map((row: FinanceContractRow) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => update({ contract: String(row.id), tab: null })}
                    aria-current={String(row.id) === selectedId}
                    className={`w-full rounded-xl border p-3 text-right text-sm transition-colors hover:bg-secondary ${String(row.id) === selectedId ? "border-emerald-600 bg-secondary" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{row.contract_number}</span>
                      <Badge variant={row.remaining === "0" ? "success" : row.received === "0" ? "warning" : "default"} label={row.claims_count === 0 ? "بدون مطالبه" : row.remaining === "0" ? "تسویه" : "در جریان"} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{row.deal_type} · {row.title}</div>
                    <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
                      <span>مطالبه: {moneyOrUnknown(row.claimed)}</span>
                      <span>وصول: {moneyOrUnknown(row.received)}</span>
                      <span>مانده: {moneyOrUnknown(row.remaining)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          {!selectedId ? (
            <Card><EmptyState icon={<Percent size={22} />} title="قراردادی انتخاب نشده" description="برای دیدن مطالبات، سهم‌ها، وجوه و سیاست کمیسیون، یکی از قراردادهای فهرست را انتخاب کنید." /></Card>
          ) : !detail ? (
            <Card><Skeleton label="در حال دریافت جزئیات قرارداد" /></Card>
          ) : (
            <>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">{detail.contract.contract_number}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{detail.contract.deal_type} · {detail.contract.title}</p>
                  </div>
                  <div className="text-left text-sm">
                    <div className="text-xs text-muted-foreground">ارزش معامله</div>
                    <div className="font-bold">{moneyOrUnknown(detail.contract.deal_value)}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge variant="default" label={`مطالبه: ${moneyOrUnknown(detail.totals.claimed)}`} />
                  <Badge variant="success" label={`وصول: ${moneyOrUnknown(detail.totals.received)}`} />
                  {detail.contract.status !== "FINALIZED" ? <Badge variant="warning" label="قرارداد قطعی نشده" /> : null}
                </div>
              </Card>
              {detail.claims.length === 0 && canManage ? (
                <Card>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><Plus size={15} /> ساخت مطالبه از قرارداد قطعی</h3>
                  <form
                    className="grid gap-3 sm:grid-cols-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      run("create-claim", () => post(csrfToken, "/crm/api/commissions/create_from_contract/", {
                        contract: detail.contract.id,
                        debtor_contact: Number(claimForm.debtor),
                        policy_version: claimForm.policy ? Number(claimForm.policy) : undefined,
                        base_amount: claimForm.policy ? claimForm.base || undefined : undefined,
                        final_amount: claimForm.policy ? undefined : claimForm.manual || undefined,
                        shares: shareBeneficiary ? [{ beneficiary_user: Number(shareBeneficiary), share_percent: "100" }] : [],
                      }), "مطالبه ساخته شد.");
                    }}
                  >
                    <Field label="طرف قرارداد (بدهکار)">
                      <select className={inputCls} value={claimForm.debtor} onChange={(event) => setClaimForm({ ...claimForm, debtor: event.target.value })} required>
                        <option value="">انتخاب کنید</option>
                        {detail.debtor_options.map((option: { contact: number; role: string; label: string }) => (
                          <option key={option.contact} value={option.contact}>{option.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="سیاست منتشرشده">
                      <select className={inputCls} value={claimForm.policy} onChange={(event) => setClaimForm({ ...claimForm, policy: event.target.value })}>
                        <option value="">بدون سیاست (مبلغ دستی)</option>
                        {detail.policies.filter((policy) => policy.status === "PUBLISHED").map((policy) => (
                          <option key={policy.id} value={policy.id}>{policy.name} · نسخه {policy.version_number} · {policySignature(policy.parameters, policy.calculation_method)}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label={claimForm.policy ? "مبلغ مبنا" : "مبلغ دستی مطالبه"}>
                      <input
                        className={inputCls}
                        type="number"
                        min="1"
                        value={claimForm.policy ? claimForm.base : claimForm.manual}
                        onChange={(event) => setClaimForm(claimForm.policy ? { ...claimForm, base: event.target.value } : { ...claimForm, manual: event.target.value })}
                        required
                      />
                    </Field>
                    <Field label="ذی‌نفع سهم (اختیاری)">
                      <select className={inputCls} value={shareBeneficiary} onChange={(event) => setShareBeneficiary(event.target.value)}>
                        <option value="">بدون سهم</option>
                        {staff.map((member) => (
                          <option key={member.id} value={member.user_id || member.id}>{member.full_name || member.username || member.name}</option>
                        ))}
                      </select>
                    </Field>
                    <div className="sm:col-span-4">
                      <Btn type="submit" disabled={busy === "create-claim"}>{busy === "create-claim" ? "در حال ساخت…" : "ساخت مطالبه"}</Btn>
                    </div>
                  </form>
                </Card>
              ) : null}
              <Card>
                <div role="tablist" aria-label="نماهای مالی قرارداد" className="mb-3 flex flex-wrap gap-2">
                  {CLAIM_TABS.map((item) => (
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
                {tab === "claims" ? (
                  <div className="space-y-3">
                    {detail.claims.length === 0 ? <EmptyState icon={<Receipt size={22} />} title="مطالبه‌ای ثبت نشده" description="از فرم بالا مطالبه بسازید؛ تا پیش از تأیید، وصول ثبت نمی‌شود." /> : detail.claims.map(renderClaim)}
                  </div>
                ) : null}
                {tab === "payments" ? (
                  <div className="space-y-2">
                    {detail.payments.length === 0 ? <EmptyState icon={<Banknote size={22} />} title="وجهی ثبت نشده" description="دریافت جزئی یا کامل از تب مطالبات ثبت می‌شود و همین‌جا با تخصیص‌ها دیده می‌شود." /> : detail.payments.map(renderPayment)}
                  </div>
                ) : null}
                {tab === "policies" ? (
                  <div className="space-y-3">
                    {detail.policies.length === 0 ? <p className="text-sm text-muted-foreground">برای این نوع معامله سیاستی ثبت نشده است.</p> : (
                      <ul className="space-y-2 text-sm">
                        {detail.policies.map((policy) => (
                          <li key={policy.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
                            <span>{policy.name} · نسخه {policy.version_number} · {policySignature(policy.parameters, policy.calculation_method)}</span>
                            <span className="flex items-center gap-2">
                              <Badge variant={policy.status === "PUBLISHED" ? "success" : "default"} label={policy.status === "PUBLISHED" ? "منتشرشده" : policy.status === "DRAFT" ? "پیش‌نویس" : "بایگانی"} />
                              {policy.status === "DRAFT" && detail.can_policy ? (
                                <Btn color="light" disabled={busy === `publish-${policy.id}`} onClick={() => run(`publish-${policy.id}`, () => post(csrfToken, `/crm/api/commission-policies/${policy.id}/publish/`), "سیاست منتشر شد.")}>
                                  <CheckCircle2 size={13} /> انتشار
                                </Btn>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {detail.can_policy ? (
                      <form
                        className="grid gap-2 rounded-xl border p-3 sm:grid-cols-5"
                        onSubmit={(event) => {
                          event.preventDefault();
                          run("create-policy", () => post(csrfToken, "/crm/api/commission-policies/", {
                            name: policyForm.name,
                            deal_type: Number(policyForm.deal_type || dealTypes[0]?.id),
                            version_number: Number(policyForm.version_number || 1),
                            calculation_method: policyForm.calculation_method,
                            parameters: policyForm.calculation_method === "PERCENT" ? { percent: policyForm.value } : { flat_amount: policyForm.value },
                          }), "نسخه پیش‌نویس سیاست ساخته شد.");
                        }}
                      >
                        <Field label="نام سیاست">
                          <input className={inputCls} required value={policyForm.name} onChange={(event) => setPolicyForm({ ...policyForm, name: event.target.value })} />
                        </Field>
                        <Field label="نوع معامله">
                          <select className={inputCls} value={policyForm.deal_type} onChange={(event) => setPolicyForm({ ...policyForm, deal_type: event.target.value })} required>
                            <option value="">انتخاب کنید</option>
                            {dealTypes.map((dealType) => <option key={dealType.id} value={dealType.id}>{dealType.display_name}</option>)}
                          </select>
                        </Field>
                        <Field label="نسخه">
                          <input className={inputCls} type="number" min="1" value={policyForm.version_number} onChange={(event) => setPolicyForm({ ...policyForm, version_number: event.target.value })} />
                        </Field>
                        <Field label="روش">
                          <select className={inputCls} value={policyForm.calculation_method} onChange={(event) => setPolicyForm({ ...policyForm, calculation_method: event.target.value })}>
                            <option value="PERCENT">درصدی</option>
                            <option value="FLAT">مبلغ ثابت</option>
                          </select>
                        </Field>
                        <Field label={policyForm.calculation_method === "PERCENT" ? "درصد" : "مبلغ ثابت"}>
                          <input className={inputCls} type="number" min="0.01" step="0.01" required value={policyForm.value} onChange={(event) => setPolicyForm({ ...policyForm, value: event.target.value })} />
                        </Field>
                        <div className="sm:col-span-5">
                          <Btn type="submit" color="light" disabled={busy === "create-policy"}>ساخت نسخه پیش‌نویس</Btn>
                        </div>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            </>
          )}
          {error ? (
            <Card>
              <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300"><AlertTriangle size={15} /> داده مالی بارگذاری نشد.</div>
              <Btn color="light" onClick={reload}><Loader2 size={13} /> تلاش دوباره</Btn>
            </Card>
          ) : null}
        </div>
      </div>
    </Shell>
  );
}
