import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Building2, CheckCircle2, MapPin, MessageSquare, Ruler, Ticket, X } from "lucide-react";
import { apiErrorMessage, apiFetch, readJson } from "../../../shared/lib/apiClient";
import { ThemeModeSwitch } from "../../../shared/components/ThemeModeSwitch";

type AttributeDetail = {
  name: string;
  displayName: string;
  dataType: string;
  unit?: string;
  value: unknown;
  displayValue: unknown;
};

type PublicPropertyFileDetail = {
  id: number;
  title: string;
  description: string;
  dealTypeDisplay: string | null;
  salePrice: string | null;
  deposit: string | null;
  monthlyRent: string | null;
  priceDetails: Record<string, unknown>;
  propertyTitle: string;
  propertyType: string;
  area: number;
  district: string;
  city: string;
  imageUrl: string | null;
  images: { id: number; url: string }[];
  propertyFileAttributeDetails: AttributeDetail[];
  propertyAttributeDetails: AttributeDetail[];
};

const formatAmount = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0
    ? `${amount.toLocaleString("fa-IR")} تومان`
    : null;
};

const formatAttributeValue = (attribute: AttributeDetail) => {
  const value = attribute.displayValue ?? attribute.value;
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  if (typeof value === "boolean") return value ? "بله" : "خیر";
  const text = Array.isArray(value) ? value.join("، ") : String(value);
  return attribute.unit ? `${text} ${attribute.unit}` : text;
};

function PublicPropertyFileDetailPage({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [propertyFile, setPropertyFile] = useState<PublicPropertyFileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ticketOpen, setTicketOpen] = useState(() => new URLSearchParams(window.location.search).get("ticket") === "1");
  const [message, setMessage] = useState("");
  const [ticketSaving, setTicketSaving] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);

  const propertyFileId = useMemo(() => {
    const match = window.location.pathname.match(/\/property-files\/(\d+)\//);
    return match?.[1] || "";
  }, []);
  const loginUrl = useMemo(() => {
    const next = `${window.location.pathname}?ticket=1`;
    return `/accounts/login/?next=${encodeURIComponent(next)}`;
  }, []);

  useEffect(() => {
    if (!propertyFileId) {
      setLoadError("نشانی فایل معتبر نیست.");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    apiFetch(`/property-files/api/public/${propertyFileId}/`, { method: "GET", signal: controller.signal })
      .then(async (response) => {
        const data = await readJson(response);
        if (!response.ok) throw new Error(apiErrorMessage(data, "دریافت جزئیات فایل انجام نشد."));
        return data as PublicPropertyFileDetail;
      })
      .then((data) => {
        if (!controller.signal.aborted) setPropertyFile(data);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setPropertyFile(null);
        setLoadError(reason instanceof Error ? reason.message : "در دریافت فایل خطایی رخ داد.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [propertyFileId]);

  const submitTicket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!propertyFile || !message.trim() || ticketSaving) return;
    setTicketSaving(true);
    setTicketError(null);
    try {
      const response = await apiFetch("/tickets/api/property-file-inquiries/", {
        method: "POST",
        body: JSON.stringify({ propertyFileId: propertyFile.id, message: message.trim() }),
      });
      const data = await readJson(response);
      if (!response.ok) {
        setTicketError(apiErrorMessage(data, "ثبت درخواست انجام نشد."));
        return;
      }
      setTicketNumber(data?.ticketNumber || null);
      setMessage("");
    } catch {
      setTicketError("در ارتباط با سامانه خطایی رخ داد. دوباره تلاش کنید.");
    } finally {
      setTicketSaving(false);
    }
  };

  const priceRows = propertyFile ? [
    ["قیمت فروش", formatAmount(propertyFile.salePrice)],
    ["ودیعه", formatAmount(propertyFile.deposit)],
    ["اجاره ماهانه", formatAmount(propertyFile.monthlyRent)],
  ].filter(([, value]) => value) as [string, string][] : [];
  const images = propertyFile?.images?.length ? propertyFile.images : propertyFile?.imageUrl ? [{ id: 0, url: propertyFile.imageUrl }] : [];

  return (
    <main className="min-h-screen bg-surface-subtle text-foreground" dir="rtl">
      <header className="border-b border-border-strong bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <a href="/property-files/explore/" className="flex items-center gap-3" aria-label="بازگشت به فایل‌ها">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-600 text-white"><Building2 size={20} /></span>
            <span><span className="block text-base font-extrabold">زمینکس</span><span className="block text-xs text-muted-foreground">فایل‌های وب‌سایت</span></span>
          </a>
          <div className="flex items-center gap-2">
            <ThemeModeSwitch />
  <a href={isAuthenticated ? "/" : "/accounts/login/"} className="inline-flex items-center gap-2 rounded-xl border border-border-strong px-4 py-2 text-sm font-semibold text-foreground-soft transition hover:border-emerald-300 dark:hover:border-emerald-500/35 hover:text-emerald-700 dark:hover:text-emerald-300">
              {isAuthenticated ? "ورود به CRM" : "ورود به سامانه"}<ArrowUpRight size={15} />
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <a href="/property-files/explore/" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-foreground-soft transition hover:text-emerald-700 dark:hover:text-emerald-300">
          <ArrowLeft size={16} /> بازگشت به فایل‌ها
        </a>

        {loading ? (
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="h-[360px] animate-pulse rounded-3xl bg-surface-muted" />
            <div className="h-[360px] animate-pulse rounded-3xl bg-surface-muted" />
          </div>
        ) : loadError ? (
          <div role="alert" className="rounded-3xl border border-red-200 dark:border-red-500/35 bg-red-50 dark:bg-red-500/12 px-6 py-12 text-center text-red-700 dark:text-red-300">
            <h1 className="text-lg font-extrabold">دسترسی به فایل ممکن نیست</h1>
            <p className="mt-2 text-sm">{loadError}</p>
            <a href="/property-files/explore/" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-card px-4 py-2 text-sm font-bold text-foreground-soft shadow-sm">مشاهده فایل‌های دیگر</a>
          </div>
        ) : propertyFile ? (
          <div className="grid items-start gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="space-y-5">
              <div className="overflow-hidden rounded-3xl border border-border-strong bg-card shadow-sm">
                {images.length ? (
                  <div className={`grid gap-1 ${images.length > 1 ? "sm:grid-cols-2" : ""}`}>
                    {images.slice(0, 4).map((image, index) => (
                      <img key={image.id} src={image.url} alt={`${propertyFile.title}، تصویر ${index + 1}`} className={`h-64 w-full object-cover ${images.length === 1 ? "sm:h-96" : index > 1 ? "hidden sm:block" : ""}`} />
                    ))}
                  </div>
                ) : (
                  <div className="flex h-72 items-center justify-center bg-surface-muted text-muted-foreground/70"><Building2 size={64} strokeWidth={1.2} /></div>
                )}
              </div>

              <section className="rounded-3xl border border-border-strong bg-card p-5 shadow-sm sm:p-7">
                <div className="flex flex-wrap items-center gap-2">
                  {propertyFile.dealTypeDisplay && <span className="rounded-full bg-emerald-50 dark:bg-emerald-500/12 px-3 py-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">{propertyFile.dealTypeDisplay}</span>}
                  {propertyFile.propertyType && <span className="rounded-full bg-surface-muted px-3 py-1.5 text-xs font-semibold text-foreground-soft">{propertyFile.propertyType}</span>}
                </div>
                <h1 className="mt-4 text-2xl font-extrabold leading-relaxed text-foreground sm:text-3xl">{propertyFile.title}</h1>
                {propertyFile.propertyTitle && propertyFile.propertyTitle !== propertyFile.title && <p className="mt-1 text-sm text-muted-foreground">{propertyFile.propertyTitle}</p>}
                {(propertyFile.city || propertyFile.district) && (
                  <p className="mt-4 inline-flex items-center gap-2 text-sm text-foreground-soft"><MapPin size={17} className="text-emerald-700 dark:text-emerald-300" />{[propertyFile.city, propertyFile.district].filter(Boolean).join("، ")}</p>
                )}
                <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {propertyFile.area > 0 && <div className="rounded-2xl bg-surface-subtle p-4"><p className="text-xs text-muted-foreground">مساحت</p><p className="mt-1 inline-flex items-center gap-1.5 text-base font-bold"><Ruler size={15} className="text-emerald-700 dark:text-emerald-300" />{propertyFile.area.toLocaleString("fa-IR")} متر مربع</p></div>}
                  {propertyFile.city && <div className="rounded-2xl bg-surface-subtle p-4"><p className="text-xs text-muted-foreground">شهر</p><p className="mt-1 text-base font-bold">{propertyFile.city}</p></div>}
                  {propertyFile.district && <div className="rounded-2xl bg-surface-subtle p-4"><p className="text-xs text-muted-foreground">محله</p><p className="mt-1 text-base font-bold">{propertyFile.district}</p></div>}
                </div>
                {propertyFile.description && (
                  <div className="mt-7 border-t border-border-strong pt-6">
                    <h2 className="text-base font-extrabold">درباره فایل</h2>
                    <p className="mt-3 whitespace-pre-line text-sm leading-8 text-foreground-soft">{propertyFile.description}</p>
                  </div>
                )}
              </section>

              {propertyFile.propertyAttributeDetails?.length > 0 && (
                <AttributeSection title="ویژگی‌های ملک" attributes={propertyFile.propertyAttributeDetails} />
              )}
              {propertyFile.propertyFileAttributeDetails?.length > 0 && (
                <AttributeSection title="جزئیات فایل" attributes={propertyFile.propertyFileAttributeDetails} />
              )}
            </section>

            <aside className="space-y-5 lg:sticky lg:top-6">
              <section className="rounded-3xl border border-border-strong bg-card p-5 shadow-sm sm:p-6">
                <h2 className="text-base font-extrabold">قیمت فایل</h2>
                {priceRows.length ? (
                  <div className="mt-4 space-y-3">
                    {priceRows.map(([label, value]) => <div key={label} className="flex items-start justify-between gap-4 border-b border-border-strong pb-3 last:border-b-0 last:pb-0"><span className="text-sm text-muted-foreground">{label}</span><span className="text-left text-sm font-extrabold text-emerald-800 dark:text-emerald-300">{value}</span></div>)}
                  </div>
                ) : <p className="mt-4 text-lg font-extrabold text-emerald-800 dark:text-emerald-300">قیمت توافقی</p>}
                <div className="mt-6 border-t border-border-strong pt-5">
                  {isAuthenticated ? (
                    <button type="button" onClick={() => { setTicketOpen(true); setTicketError(null); }} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-emerald-800"><Ticket size={17} /> ثبت تیکت درباره این فایل</button>
                  ) : (
                    <a href={loginUrl} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-emerald-800"><Ticket size={17} /> ورود و ثبت درخواست</a>
                  )}
                  <p className="mt-3 text-center text-xs leading-6 text-muted-foreground">درخواست شما از طریق سامانه به مسئول فایل ارجاع می‌شود.</p>
                </div>
              </section>

              <section className="rounded-3xl border border-emerald-100 dark:border-emerald-500/35 bg-emerald-50 dark:bg-emerald-500/12 p-5">
                <div className="flex items-start gap-3">
                  <span className="rounded-xl bg-card p-2 text-emerald-700 dark:text-emerald-300"><MessageSquare size={17} /></span>
                  <div><h2 className="text-sm font-extrabold text-emerald-950 dark:text-emerald-300">نیاز به اطلاعات بیشتر دارید؟</h2><p className="mt-1 text-xs leading-6 text-emerald-900/75 dark:text-emerald-300/75">برای پیگیری این فایل، درخواست خود را ثبت کنید تا به کارشناس مسئول برسد.</p></div>
                </div>
              </section>
            </aside>
          </div>
        ) : null}
      </div>

      {ticketOpen && propertyFile && isAuthenticated && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTicketOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="propertyFile-ticket-title" className="w-full max-w-lg rounded-t-3xl bg-card p-5 shadow-2xl sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div><h2 id="propertyFile-ticket-title" className="text-lg font-extrabold">تیکت درباره فایل</h2><p className="mt-1 text-sm text-muted-foreground">{propertyFile.title}</p></div>
              <button type="button" aria-label="بستن" onClick={() => setTicketOpen(false)} className="rounded-xl p-2 text-muted-foreground transition hover:bg-surface-muted"><X size={18} /></button>
            </div>
            {ticketNumber ? (
              <div className="mt-6 rounded-2xl border border-emerald-200 dark:border-emerald-500/35 bg-emerald-50 dark:bg-emerald-500/12 p-4 text-center">
                <CheckCircle2 className="mx-auto text-emerald-700 dark:text-emerald-300" size={30} />
                <p className="mt-2 font-bold text-emerald-900 dark:text-emerald-300">درخواست شما ثبت شد</p>
                <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">{ticketNumber ? `شماره تیکت: ${ticketNumber}` : "تیکت در سامانه ثبت شد."}</p>
                <button type="button" onClick={() => setTicketOpen(false)} className="mt-4 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">بستن</button>
              </div>
            ) : (
              <form onSubmit={submitTicket} className="mt-5">
                <label htmlFor="propertyFile-ticket-message" className="mb-2 block text-sm font-semibold text-foreground-soft">پیام شما</label>
                <textarea id="propertyFile-ticket-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={10000} required rows={5} placeholder="درخواست یا پرسش خود درباره این فایل را بنویسید" className="w-full resize-y rounded-2xl border border-border-strong bg-card p-3.5 text-sm leading-7 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" />
                {ticketError && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-300">{ticketError}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => setTicketOpen(false)} className="rounded-xl border border-border-strong px-4 py-2.5 text-sm font-semibold text-foreground-soft">لغو</button>
                  <button type="submit" disabled={ticketSaving || !message.trim()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{ticketSaving ? "در حال ثبت…" : "ثبت تیکت"}<ArrowUpRight size={15} /></button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}

      <footer className="border-t border-border-strong bg-card">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6"><span>© زمینکس</span><a href="/property-files/explore/" className="font-semibold hover:text-emerald-700 dark:hover:text-emerald-300">بازگشت به فایل‌ها</a></div>
      </footer>
    </main>
  );
}

function AttributeSection({ title, attributes }: { title: string; attributes: AttributeDetail[] }) {
  const visible = attributes.map((attribute) => ({ attribute, value: formatAttributeValue(attribute) })).filter((item) => item.value);
  if (!visible.length) return null;
  return (
    <section className="rounded-3xl border border-border-strong bg-card p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-extrabold">{title}</h2>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {visible.map(({ attribute, value }) => <div key={attribute.name} className="rounded-2xl bg-surface-subtle p-3.5"><p className="text-xs text-muted-foreground">{attribute.displayName}</p><p className="mt-1 text-sm font-bold text-foreground">{value}</p></div>)}
      </div>
    </section>
  );
}

export { PublicPropertyFileDetailPage };
