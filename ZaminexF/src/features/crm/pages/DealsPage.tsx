import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../../shared/components/ui/Badge";
import { EmptyState } from "../../../shared/components/ui/EmptyState";
import { usePermissions } from "../../../shared/lib/permissions";
import { Btn, Card, Field, SearchBar, Shell, inputCls } from "../components/CrmUIKit";
import { post } from "../lib/crmApi";
import { useLoad } from "../lib/useCrmLoad";
import { DEAL_STAGE_LABELS } from "../lib/commercialDomain";
import type { CrmNavigate, Row } from "../types";

const STAGE_ORDER = ["NEGOTIATION", "AGREED", "CONTRACT", "FINALIZED"];

const ROLE_LABELS: Record<string, string> = {
  BUYER: "خریدار",
  SELLER: "فروشنده",
  TENANT: "مستأجر",
  LANDLORD: "موجر",
  REPRESENTATIVE: "نماینده",
};

export function Deals({ csrfToken, navigate, recordId, currentUserId }: { csrfToken: string; navigate: CrmNavigate; recordId?: string | null; currentUserId?: string | null }) {
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(recordId ? String(recordId) : null);
  const [resultNotes, setResultNotes] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [participant, setParticipant] = useState({ contact: "", participant_role: "BUYER" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (recordId) setSelectedId(String(recordId));
  }, [recordId]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page_size: "100" });
    if (search.trim()) params.set("search", search.trim());
    if (stage) params.set("stage", stage);
    return `/crm/api/deals/?${params.toString()}`;
  }, [search, stage]);
  const urls = useMemo(() => [query, "/crm/api/contacts/?page_size=200"], [query]);
  const { data, error, loading, reload } = useLoad(urls, csrfToken);
  const deals: Row[] = data[query] || [];
  const contacts: Row[] = data[urls[1]] || [];
  const selected = deals.find((item) => String(item.id) === String(selectedId)) || null;
  const activeIndex = selected ? STAGE_ORDER.indexOf(selected.stage) : -1;

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
      title="مذاکرات"
      subtitle="مذاکره فقط از بازدید با نتیجهٔ مثبت شروع می‌شود؛ توافق موفق پرونده را برای قرارداد آماده می‌کند و عدم توافق دلیل الزامی دارد."
      error={error}
      loading={loading && !Object.keys(data).length}
      onReload={reload}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <SearchBar value={search} onChange={setSearch} placeholder="جست‌وجو بر اساس کد درخواست، فایل یا مسئول…" flush />
        <div className="flex gap-2">
          <select aria-label="مرحلهٔ مذاکره" value={stage} onChange={(event) => setStage(event.target.value)} className={inputCls}>
            <option value="">همهٔ مراحل</option>
            {Object.entries(DEAL_STAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <Btn color="light" onClick={() => navigate("crm-introductions")}>معرفی‌ها</Btn>
        </div>
      </div>
      {message ? <div role="status" className="mb-4 rounded-xl bg-secondary px-4 py-3 text-sm">{message}</div> : null}
      <div className="grid gap-4 xl:grid-cols-[1fr_1.3fr]">
        <div className="space-y-3">
          {deals.map((item) => (
            <Card key={item.id} className={`cursor-pointer space-y-2 hover:border-emerald-500 ${String(item.id) === String(selectedId) ? "border-emerald-600" : ""}`}>
              <button type="button" className="w-full text-right" onClick={() => setSelectedId(String(item.id))}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground">{item.inquiry_code}</div>
                    <strong>{item.property_file_title}</strong>
                  </div>
                  <Badge label={DEAL_STAGE_LABELS[item.stage] || item.stage} variant={item.stage === "FINALIZED" ? "success" : item.stage === "LOST" ? "danger" : item.stage === "AGREED" ? "info" : "warning"} />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">متقاضی: {item.contact_name} · مسئول: {item.assigned_to_name || "—"}</div>
              </button>
            </Card>
          ))}
          {!deals.length && !loading ? <EmptyState title="مذاکره‌ای یافت نشد" description="از معرفی با بازدید مورد پسند، مذاکره را آغاز کنید." /> : null}
        </div>
        <Card className="space-y-3">
          {selected ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">{selected.inquiry_code}</div>
                  <h2 className="text-lg font-bold">{selected.property_file_title}</h2>
                  <p className="text-xs text-muted-foreground">متقاضی: {selected.contact_name} · مسئول: {selected.assigned_to_name || "—"}</p>
                </div>
                <Btn color="light" onClick={() => navigate("crm-inquiries", selected.inquiry)}>پروندهٔ متقاضی</Btn>
              </div>
              <ol className="grid grid-cols-4 gap-1 text-center text-xs">
                {STAGE_ORDER.map((item, index) => (
                  <li key={item} className={`rounded-xl border p-2 ${selected.stage === item ? "border-emerald-600 bg-emerald-50/60 dark:bg-emerald-500/12" : index < activeIndex ? "bg-secondary" : ""}`}>
                    <span className="block font-bold">{DEAL_STAGE_LABELS[item]}</span>
                    <span className="text-muted-foreground">{selected.stage === item ? "جاری" : index < activeIndex ? "طی‌شده" : "بعدی"}</span>
                  </li>
                ))}
              </ol>
              {selected.stage === "LOST" ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/12 dark:text-red-300">دلیل عدم توافق: {selected.closure_reason || "ثبت نشده"}</p> : null}
              <div className="space-y-2">
                <h3 className="font-bold">طرفین مذاکره</h3>
                {(selected.participants || []).map((item: Row) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 text-sm">
                    <span>{item.contact_name}</span>
                    <span className="text-xs text-muted-foreground">{ROLE_LABELS[item.participant_role] || item.participant_role}{item.is_primary ? " · طرف اصلی" : ""}</span>
                  </div>
                ))}
                {(selected.participants || []).length ? null : <p className="text-xs text-muted-foreground">طرفی ثبت نشده است.</p>}
                {selected.stage === "NEGOTIATION" && can("deal.manage") ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <select value={participant.contact} onChange={(event) => setParticipant({ ...participant, contact: event.target.value })} className={inputCls}>
                      <option value="">افزودن شخص</option>
                      {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.full_name}</option>)}
                    </select>
                    <select value={participant.participant_role} onChange={(event) => setParticipant({ ...participant, participant_role: event.target.value })} className={inputCls}>
                      {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <Btn
                      color="light"
                      disabled={!participant.contact || busy}
                      onClick={() => act(`/crm/api/deals/${selected.id}/participants/`, { contact: Number(participant.contact), participant_role: participant.participant_role }, "طرف مذاکره افزوده شد.")}
                    >
                      افزودن طرف
                    </Btn>
                  </div>
                ) : null}
              </div>
              {selected.stage === "NEGOTIATION" ? (
                <div className="space-y-2 border-t pt-3">
                  <Field label="توضیحات نتیجه">
                    <input value={resultNotes} onChange={(event) => setResultNotes(event.target.value)} className={inputCls} />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Btn disabled={busy || !can("deal.manage")} onClick={() => act(`/crm/api/deals/${selected.id}/succeed/`, { result_notes: resultNotes, version: selected.version }, "نتیجهٔ موفق ثبت شد و وظیفهٔ آماده‌سازی قرارداد برای مدیر کل ساخته شد.")}>نتیجهٔ موفق</Btn>
                    <Btn color="light" onClick={() => navigate("crm-contracts")}>رفتن به قراردادها</Btn>
                  </div>
                  <Field label="دلیل عدم توافق (الزامی)">
                    <input value={closeReason} onChange={(event) => setCloseReason(event.target.value)} className={inputCls} />
                  </Field>
                  <Btn color="light" disabled={busy || !closeReason.trim() || !can("deal.manage")} onClick={() => act(`/crm/api/deals/${selected.id}/close/`, { closure_reason: closeReason.trim(), version: selected.version }, "عدم توافق ثبت شد.")}>ثبت عدم توافق</Btn>
                </div>
              ) : null}
              {selected.stage === "AGREED" ? (
                <p className="rounded-xl bg-secondary px-3 py-2 text-sm">این مذاکره در وضعیت توافق است؛ تنظیم قرارداد در اختیار مدیر کل است.</p>
              ) : null}
              {selected.stage === "CONTRACT" || selected.stage === "FINALIZED" ? (
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Btn color="light" onClick={() => navigate("crm-contracts")}>قرارداد مرتبط</Btn>
                  <span className="self-center text-xs text-muted-foreground">{currentUserId ? `شناسهٔ شما: ${currentUserId}` : ""}</span>
                </div>
              ) : null}
            </>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">یک مذاکره را انتخاب کنید.</p>
          )}
        </Card>
      </div>
    </Shell>
  );
}
