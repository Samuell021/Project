import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Building2, ChevronLeft, ChevronRight, MapPin, Search, Sparkles } from "lucide-react";
import { ThemeModeSwitch } from "../../../shared/components/ThemeModeSwitch";

type PublicPropertyFile = {
  id: number;
  title: string;
  description: string;
  dealTypeId: number | null;
  dealTypeName: string | null;
  dealTypeDisplay: string | null;
  salePrice: string | null;
  deposit: string | null;
  monthlyRent: string | null;
  propertyTitle: string;
  propertyType: string;
  area: number;
  district: string;
  city: string;
  imageUrl: string | null;
};

type PropertyFilePageData = {
  count: number;
  next: string | null;
  previous: string | null;
  results: PublicPropertyFile[];
};

const pageFromLocation = () => {
  const raw = new URLSearchParams(window.location.search).get("page");
  const value = Number(raw || "1");
  return Number.isInteger(value) && value > 0 ? value : 1;
};

const formatAmount = (value: string | null) => {
  if (!value) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0
    ? `${amount.toLocaleString("fa-IR")} تومان`
    : null;
};

function PublicPropertyFilesPage() {
  const initialParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const [query, setQuery] = useState(initialParams.get("q") || "");
  const [search, setSearch] = useState(initialParams.get("q") || "");
  const [dealType, setDealType] = useState(initialParams.get("dealType") || "");
  const [page, setPage] = useState(pageFromLocation);
  const [propertyFiles, setPropertyFiles] = useState<PublicPropertyFile[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (dealType) params.set("dealType", dealType);
    if (page > 1) params.set("page", String(page));
    const suffix = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${suffix ? `?${suffix}` : ""}`);
  }, [query, dealType, page]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), page_size: "12" });
    if (search) params.set("q", search);
    if (dealType) params.set("dealType", dealType);

    setLoading(true);
    setError(null);
    fetch(`/crm/api/explore/?${params.toString()}`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.detail || "دریافت فایل‌ها انجام نشد.");
        return data as PropertyFilePageData;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        const normalized = Array.isArray(data.results)
          ? data.results.map((raw) => {
              const row = raw as unknown as Record<string, unknown>;
              return {
                id: Number(row.id),
                title: String(row.title || row.property_title || "فایل عرضه"),
                description: String(row.description || ""),
                dealTypeId: typeof row.dealTypeId === "number" ? row.dealTypeId : typeof row.deal_type === "number" ? row.deal_type : null,
                dealTypeName: (row.dealTypeName ?? row.deal_type_name ?? null) as string | null,
                dealTypeDisplay: (row.dealTypeDisplay ?? row.deal_type_display ?? null) as string | null,
                salePrice: (row.salePrice ?? row.sale_price ?? null) as string | null,
                deposit: (row.deposit ?? null) as string | null,
                monthlyRent: (row.monthlyRent ?? row.monthly_rent ?? null) as string | null,
                propertyTitle: String(row.propertyTitle || row.property_title || "نامشخص"),
                propertyType: String(row.propertyType || row.property_type_display || row.property_type || "نامشخص"),
                area: Number(row.area ?? 0),
                district: String(row.district || row.district_name || "نامشخص"),
                city: String(row.city || row.city_name || "نامشخص"),
                imageUrl: (row.imageUrl ?? row.image_url ?? null) as string | null,
              };
            })
          : [];
        setPropertyFiles(normalized);
        setCount(Number(data.count || normalized.length));
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setPropertyFiles([]);
        setCount(0);
        setError(reason instanceof Error ? reason.message : "در ارتباط با سرور خطایی رخ داد.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [search, dealType, page]);

  const totalPages = Math.max(1, Math.ceil(count / 12));
  const hasFilters = Boolean(search || dealType);

  const updateQuery = (value: string) => {
    setQuery(value);
    setPage(1);
  };

  const updateDealType = (value: string) => {
    setDealType(value);
    setPage(1);
  };

  const propertyFilePrice = (propertyFile: PublicPropertyFile) => {
    const salePrice = formatAmount(propertyFile.salePrice);
    const deposit = formatAmount(propertyFile.deposit);
    const monthlyRent = formatAmount(propertyFile.monthlyRent);
    if (salePrice) return { primary: salePrice, secondary: null };
    if (deposit || monthlyRent) {
      return {
        primary: deposit ? `ودیعه ${deposit}` : "اجاره",
        secondary: monthlyRent ? `اجاره ماهانه ${monthlyRent}` : null,
      };
    }
    return { primary: "قیمت توافقی", secondary: null };
  };

  return (
    <main className="min-h-screen bg-surface-subtle text-foreground" dir="rtl">
      <header className="border-b border-border-strong bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <a href="/property-files/explore/" className="flex items-center gap-3" aria-label="زمینکس">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
              <Building2 size={20} />
            </span>
            <span>
              <span className="block text-base font-extrabold tracking-tight">زمینکس</span>
              <span className="block text-xs text-muted-foreground">خانه‌ای برای انتخاب بعدی شما</span>
            </span>
          </a>
          <div className="flex items-center gap-2">
            <ThemeModeSwitch />
  <a href="/accounts/login/" className="inline-flex items-center gap-2 rounded-xl border border-border-strong px-4 py-2 text-sm font-semibold text-foreground-soft transition hover:border-emerald-300 dark:hover:border-emerald-500/35 hover:text-emerald-700 dark:hover:text-emerald-300">
              ورود به سامانه
              <ArrowUpRight size={15} />
            </a>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-slate-950 text-white">
        <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "radial-gradient(circle at 15% 20%, color-mix(in srgb, var(--primary) 70%, transparent) 0, transparent 34%), radial-gradient(circle at 85% 80%, color-mix(in srgb, var(--chart-1) 55%, transparent) 0, transparent 30%)" }} />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1fr_360px] lg:items-center lg:px-8">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-emerald-200">
              <Sparkles size={14} />
              فایل‌های فعال منتشرشده در وب‌سایت
            </div>
            <h1 className="max-w-3xl text-3xl font-extrabold leading-tight sm:text-5xl">
              خانه‌ای که می‌خواهید،
              <span className="block text-emerald-300">با جست‌وجویی ساده‌تر</span>
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground/70 sm:text-base">
              فایل‌های به‌روز فروش و اجاره را از میان گزینه‌های منتشرشده در وب‌سایت پیدا کنید.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur-sm sm:p-6">
            <label htmlFor="propertyFile-search" className="mb-2 block text-sm font-semibold text-white">جست‌وجوی فایل</label>
            <div className="relative">
              <Search size={17} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                id="propertyFile-search"
                value={query}
                onChange={(event) => updateQuery(event.target.value)}
                placeholder="عنوان، شهر یا محله را بنویسید"
                className="w-full rounded-2xl border border-white/10 bg-white/10 py-3 pr-10 pl-4 text-sm text-white outline-none transition placeholder:text-muted-foreground focus:border-emerald-300 dark:focus:border-emerald-500/35 focus:ring-2 focus:ring-emerald-400/20"
              />
            </div>
            <label htmlFor="deal-type" className="mb-2 mt-4 block text-sm font-semibold text-white">نوع معامله</label>
            <select
              id="deal-type"
              value={dealType}
              onChange={(event) => updateDealType(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-300 dark:focus:border-emerald-500/35 focus:ring-2 focus:ring-emerald-400/20"
            >
              <option value="">همه فایل‌ها</option>
              <option value="sale">فروش</option>
              <option value="mortgage_rent">رهن و اجاره</option>
              <option value="full_mortgage">رهن کامل</option>
              <option value="presale">پیش‌فروش</option>
              <option value="exchange">معاوضه</option>
              <option value="partnership">مشارکت در ساخت</option>
            </select>
            <p className="mt-3 text-xs leading-6 text-muted-foreground">هر فایل بر اساس نوع معامله خودش نمایش داده می‌شود.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-foreground">فایل‌های وب‌سایت</h2>
            <p className="mt-1 text-sm text-muted-foreground">{loading ? "در حال دریافت فایل‌ها…" : `${count.toLocaleString("fa-IR")} فایل پیدا شد`}</p>
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={() => { updateQuery(""); updateDealType(""); }}
              className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 transition hover:text-emerald-900 dark:hover:text-emerald-300"
            >
              پاک‌کردن فیلترها
            </button>
          )}
        </div>

        {error && (
          <div role="alert" className="mb-6 rounded-2xl border border-red-200 dark:border-red-500/35 bg-red-50 dark:bg-red-500/12 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>
        )}

        {loading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-[340px] animate-pulse rounded-3xl bg-surface-muted" />)}
          </div>
        ) : propertyFiles.length ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {propertyFiles.map((propertyFile) => {
              const price = propertyFilePrice(propertyFile);
              return (
                <article key={propertyFile.id} className="group overflow-hidden rounded-3xl border border-border-strong bg-card shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
                  <div className="relative h-52 overflow-hidden bg-surface-muted">
                    {propertyFile.imageUrl ? (
                      <img src={propertyFile.imageUrl} alt={propertyFile.title} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground/70"><Building2 size={48} strokeWidth={1.25} /></div>
                    )}
                    <span className="absolute right-4 top-4 rounded-full bg-card/95 px-3 py-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300 shadow-sm">
                      {propertyFile.dealTypeDisplay || propertyFile.dealTypeName || "فایل"}
                    </span>
                  </div>
                  <div className="p-5">
                    <h3 className="line-clamp-1 text-base font-bold text-foreground">{propertyFile.title}</h3>
                    {propertyFile.propertyTitle && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{propertyFile.propertyTitle}</p>}
                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                      {(propertyFile.city || propertyFile.district) && (
                        <span className="inline-flex items-center gap-1"><MapPin size={13} />{[propertyFile.city, propertyFile.district].filter(Boolean).join("، ")}</span>
                      )}
                      {propertyFile.area > 0 && <span>{propertyFile.area.toLocaleString("fa-IR")} متر مربع</span>}
                      {propertyFile.propertyType && <span>{propertyFile.propertyType}</span>}
                    </div>
                    {propertyFile.description && <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-6 text-foreground-soft">{propertyFile.description}</p>}
                    <div className="mt-5 border-t border-border-strong pt-4">
                      <p className="text-sm font-extrabold text-emerald-800 dark:text-emerald-300">{price.primary}</p>
                      {price.secondary && <p className="mt-1 text-xs font-medium text-muted-foreground">{price.secondary}</p>}
                    </div>
                    <a href={`/property-files/${propertyFile.id}/`} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-500/12 px-3.5 py-2 text-sm font-bold text-emerald-800 dark:text-emerald-300 transition hover:bg-emerald-100 dark:hover:bg-emerald-500/18">
                      مشاهده جزئیات
                      <ArrowUpRight size={15} />
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-border-strong bg-card px-6 py-16 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-muted text-muted-foreground"><Building2 size={24} /></span>
            <h3 className="mt-4 text-base font-bold text-foreground">فایل‌ای پیدا نشد</h3>
            <p className="mt-2 text-sm text-muted-foreground">عبارت جست‌وجو یا نوع معامله را تغییر دهید.</p>
          </div>
        )}

        {!loading && totalPages > 1 && (
          <nav aria-label="صفحه‌های فایل‌ها" className="mt-8 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-xl border border-border-strong bg-card px-3 py-2 text-sm font-semibold text-foreground-soft disabled:cursor-not-allowed disabled:opacity-40"
            ><ChevronRight size={16} />قبلی</button>
            <span className="text-sm text-muted-foreground">صفحه {page.toLocaleString("fa-IR")} از {totalPages.toLocaleString("fa-IR")}</span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages}
              className="inline-flex items-center gap-1 rounded-xl border border-border-strong bg-card px-3 py-2 text-sm font-semibold text-foreground-soft disabled:cursor-not-allowed disabled:opacity-40"
            >بعدی<ChevronLeft size={16} /></button>
          </nav>
        )}
      </section>

      <footer className="border-t border-border-strong bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>© زمینکس</span>
          <a href="/accounts/login/" className="inline-flex items-center gap-1 font-semibold text-foreground-soft hover:text-emerald-700 dark:hover:text-emerald-300">ورود کارشناسان و مدیران <ArrowLeft size={13} /></a>
        </div>
      </footer>
    </main>
  );
}

export { PublicPropertyFilesPage };
