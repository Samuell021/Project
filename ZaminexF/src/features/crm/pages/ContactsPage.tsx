import React, { useEffect, useMemo, useState } from "react";
import { useLoad } from "../lib/useCrmLoad";
import { patchRecord, post } from "../lib/crmApi";
import { Shell, Card, Btn, Field, inputCls, SearchBar } from "../components/CrmUIKit";
import type { Row, CrmNavigate } from "../types";
import type { Page } from "../../../shared/lib/types";

export function Contacts({ csrfToken, navigate, initialRecordId }: { csrfToken: string; navigate: CrmNavigate; initialRecordId?: string | null }) {
  const [search, setSearch] = useState("");
  const contactsUrl = useMemo(() => `/crm/api/contacts/?search=${encodeURIComponent(search.trim())}`, [search]);
  const { data, error, loading, reload } = useLoad([contactsUrl], csrfToken);
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [editing, setEditing] = useState(false);
  const [legacyNotes, setLegacyNotes] = useState("");
  const rows: Row[] = data[contactsUrl] || [];
  const relatedUrl = selected ? `/crm/api/contacts/${selected.id}/related/` : "";
  const relatedLoad = useLoad([relatedUrl], csrfToken);
  const related = relatedLoad.data[relatedUrl] || {};

  useEffect(() => {
    if (!initialRecordId || !rows.length) return;
    const match = rows.find((row) => String(row.id) === String(initialRecordId));
    if (match) setSelected((current) => String(current?.id) === String(match.id) ? current : match);
  }, [rows, initialRecordId]);
  useEffect(() => {
    if (!initialRecordId) setSelected(null);
  }, [initialRecordId]);

  async function saveContact(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const fd = new FormData(e.currentTarget);
    try {
      await patchRecord(csrfToken, `/crm/api/contacts/${selected.id}/`, {
        version: selected.version,
        full_name: fd.get("full_name"),
        national_code: fd.get("national_code") || "",
        email: fd.get("email") || "",
        notes: fd.get("notes") || "",
        phones: fd.get("phone") ? [{ phone: fd.get("phone"), label: "موبایل", is_primary: true }] : [],
      });
      setMsg("تغییرات شخص ذخیره شد.");
      setEditing(false);
      setSelected(null);
      reload();
    } catch (err) { setMsg(err instanceof Error ? err.message : "خطا"); }
  }

  async function reviewLegacy() {
    if (!selected) return;
    try {
      await post(csrfToken, `/crm/api/contacts/${selected.id}/review_legacy/`, { legacy_review_status: "REVIEWED", notes: legacyNotes });
      setMsg("بازبینی هویت ثبت شد.");
      setLegacyNotes("");
      setSelected(null);
      reload();
    } catch (err) { setMsg(err instanceof Error ? err.message : "خطا"); }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await post(csrfToken, "/crm/api/contacts/", { full_name: fd.get("full_name"), national_code: fd.get("national_code") || "", email: fd.get("email") || "", notes: fd.get("notes") || "", phones: [{ phone: fd.get("phone"), label: "موبایل", is_primary: true }] });
      setMsg("شخص ثبت شد."); e.currentTarget.reset(); reload();
    } catch (err) { setMsg(err instanceof Error ? err.message : "خطا"); }
  }
  return (
    <Shell title="اشخاص" subtitle="یک شخص می‌تواند مالک، متقاضی و طرف قرارداد باشد؛ شماره مشابه فقط هشدار تکراری است و ادغام خودکار انجام نمی‌شود." error={error} loading={loading && !Object.keys(data).length} onReload={reload}>
      {msg ? <div role="status" className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-500/12 dark:text-emerald-300">{msg}</div> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <form onSubmit={submit} className="space-y-3">
            <Field label="نام و نام خانوادگی"><input name="full_name" required className={inputCls} /></Field>
            <Field label="شماره تماس"><input name="phone" required className={inputCls} /></Field>
            <Field label="کد ملی"><input name="national_code" className={inputCls} /></Field>
            <Field label="ایمیل"><input name="email" type="email" className={inputCls} /></Field>
            <Field label="یادداشت"><textarea name="notes" className={inputCls} /></Field>
            <Btn type="submit">ثبت شخص</Btn>
          </form>
        </Card>
        <div className="space-y-3 lg:col-span-2">
          <SearchBar value={search} onChange={setSearch} placeholder="جست‌وجو بر اساس نام، کد ملی، تلفن یا پرونده…" />
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-3">
              {rows.map((r) => (
                <button key={r.id} type="button" onClick={() => { setSelected(r); navigate("crm-contacts", r.id); }} className={`w-full rounded-2xl border bg-card p-4 text-right shadow-sm transition ${String(selected?.id) === String(r.id) ? "border-emerald-600" : "hover:border-emerald-400"}`}>
                  <div className="flex flex-wrap justify-between gap-2"><strong>{r.full_name}</strong><span className="text-xs text-muted-foreground">{(r.phones || []).map((p: Row) => p.phone).join("، ")}</span></div>
                  {r.duplicate_phone_ids?.length ? <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/12 dark:text-amber-300">شماره تماس مشابه با شخص دیگری وجود دارد؛ پیش از ثبت پرونده بررسی کنید.</div> : null}
                </button>
              ))}
              {!rows.length ? <Card>شخصی مطابق جست‌وجو یافت نشد.</Card> : null}
            </div>
            <Card>
              {selected ? (
                <div className="space-y-3">
                  <div><div className="text-xs text-muted-foreground">جزئیات شخص</div><h2 className="text-lg font-bold">{selected.full_name}</h2></div>
                  <div className="text-sm">کد ملی: {selected.national_code || "—"}</div>
                  <div className="text-sm">ایمیل: {selected.email || "—"}</div>
                  <div className="text-sm">تلفن‌ها: {(selected.phones || []).map((phone: Row) => `${phone.phone}${phone.label ? ` (${phone.label})` : ""}`).join("، ") || "—"}</div>
                  {selected.notes ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{selected.notes}</p> : null}
                  {editing ? (
                    <form onSubmit={saveContact} className="space-y-2 rounded-xl border p-3">
                      <Field label="نام و نام خانوادگی"><input name="full_name" defaultValue={selected.full_name} required className={inputCls} /></Field>
                      <Field label="شماره تماس"><input name="phone" defaultValue={(selected.phones || [])[0]?.phone || ""} className={inputCls} /></Field>
                      <Field label="کد ملی"><input name="national_code" defaultValue={selected.national_code} className={inputCls} /></Field>
                      <Field label="ایمیل"><input name="email" defaultValue={selected.email} className={inputCls} /></Field>
                      <Field label="یادداشت"><textarea name="notes" defaultValue={selected.notes} className={inputCls} /></Field>
                      <div className="flex gap-2"><Btn type="submit">ذخیره</Btn><Btn type="button" color="light" onClick={() => setEditing(false)}>انصراف</Btn></div>
                    </form>
                  ) : <Btn type="button" color="light" onClick={() => setEditing(true)}>ویرایش شخص</Btn>}
                  {selected.is_legacy_placeholder || selected.legacy_review_status === "NEEDS_REVIEW" ? (
                    <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
                      <p className="text-xs text-amber-900 dark:text-amber-200">این شخص از داده‌های قدیمی منتقل شده و هنوز بازبینی نشده است. پیش از استفاده در پرونده، هویت و شماره تماس را بررسی کنید.</p>
                      <Field label="یادداشت بازبینی"><input value={legacyNotes} onChange={(event) => setLegacyNotes(event.target.value)} className={inputCls} /></Field>
                      <Btn type="button" onClick={reviewLegacy}>ثبت بازبینی هویت</Btn>
                    </div>
                  ) : null}
                  <div className="border-t pt-3"><h3 className="mb-2 font-semibold">املاک مرتبط</h3>
                    {(related.properties || []).map((item: Row) => (
                      <div key={`property-${item.id}`} className="mb-2 flex items-center justify-between rounded-xl border p-3 text-sm"><span>{item.title} · {item.internal_code}</span><span className="text-xs text-muted-foreground">{item.role === "OWNER" ? "مالک" : "طرف ملک"}{item.ended_at ? " · پایان‌یافته" : ""}</span></div>
                    ))}
                    {!(related.properties || []).length ? <p className="text-xs text-muted-foreground">ملکی به این شخص متصل نیست.</p> : null}
                  </div>
                  <div className="border-t pt-3"><h3 className="mb-2 font-semibold">پرونده‌های مرتبط</h3>
                    {relatedLoad.loading ? <p className="text-xs text-muted-foreground">در حال دریافت…</p> : null}
                    {[...(related.property_cases || []).map((item: Row) => ({ ...item, page: "crm-property-cases" as Page, label: "پروندهٔ ملک" })), ...(related.inquiries || []).map((item: Row) => ({ ...item, page: "crm-inquiries" as Page, label: "درخواست متقاضی" }))].map((item: Row) => (
                      <button key={`${item.type}-${item.id}`} type="button" onClick={() => navigate(item.page, item.id)} className="mb-2 flex w-full items-center justify-between rounded-xl border p-3 text-right text-sm hover:border-emerald-500"><span>{item.label} · {item.code}</span><span className="text-xs text-muted-foreground">{item.status}</span></button>
                    ))}
                    {!relatedLoad.loading && !(related.property_cases || []).length && !(related.inquiries || []).length ? <p className="text-xs text-muted-foreground">پروندهٔ مرتبطی ثبت نشده است.</p> : null}
                  </div>
                </div>
              ) : <div className="text-sm text-muted-foreground">برای مشاهده جزئیات، یک شخص را انتخاب کنید.</div>}
            </Card>
          </div>
        </div>
      </div>
    </Shell>
  );
}
