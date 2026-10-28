import React, { useEffect, useMemo, useState } from "react";
import { Badge } from "../../../shared/components/ui/Badge";
import { Btn } from "../../../shared/components/ui/Btn";
import { Card } from "../../../shared/components/ui/Card";
import { PropertyFileDetailModal } from "./PropertyFileDetailModal";
import { propertyFileCardTarget } from "../../../shared/lib/propertyFileCardTarget";
import type { Page } from "../../../shared/lib/types";
import { Pagination } from "../../../shared/components/Pagination";
import { ProfileAvatar } from "../../../shared/components/ui/ProfileAvatar";
import { useBasicsCatalog } from "../../../shared/lib/useAttributeSchema";
import { apiErrorMessage, apiFetch, readJson } from "../../../shared/lib/apiClient";
import { toPersianChannel, toPersianDeal } from "../../../shared/lib/utils";
import {
  EMPTY_PROPERTY_FILE_EXPLORE_FILTERS,
  PROPERTY_FILE_CHANNEL_CODES,
  buildPropertyFileExploreParams,
  consultantInitials,
  propertyFilePriceLabel,
} from "../../../shared/lib/propertyFileExplore";
import type {
  PropertyFileExploreFilters,
  PropertyFileExploreItem as ExplorePropertyFile,
} from "../../../shared/lib/propertyFileExplore";
import {
  Compass,
  FileText,
  MapPin,
  Ruler,
  Search,
  Send,
  SlidersHorizontal,
  X,
} from "lucide-react";

const EXPLORE_PAGE_SIZE = 12;

function PropertyFileExplorer({
  navigate,
  onIntroduced,
}: {
  navigate: (p: Page, id?: string | number) => void;
  onIntroduced?: (propertyFileId: number) => void;
}) {
  const { catalog } = useBasicsCatalog();
  const [filters, setFilters] = useState<PropertyFileExploreFilters>(EMPTY_PROPERTY_FILE_EXPLORE_FILTERS);
  const [applied, setApplied] = useState<PropertyFileExploreFilters>(EMPTY_PROPERTY_FILE_EXPLORE_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(EXPLORE_PAGE_SIZE);
  const [rows, setRows] = useState<ExplorePropertyFile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [detailId, setDetailId] = useState<string | number | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = buildPropertyFileExploreParams(applied, page, pageSize);
    setLoading(true);
    setError(null);
    apiFetch(`/property-files/api/property-files/explore/?${params.toString()}`, {
      method: "GET",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await readJson(response);
        if (!response.ok) {
          throw new Error(apiErrorMessage(data, "دریافت فایل‌ها انجام نشد."));
        }
        return data;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setRows(Array.isArray(data?.results) ? data.results : []);
        setTotal(Number(data?.count || 0));
      })
      .catch((reason: any) => {
        if (controller.signal.aborted) return;
        setRows([]);
        setTotal(0);
        setError(reason?.message || "در دریافت فایل‌ها خطایی رخ داد.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [applied, page, pageSize, revision]);

  const applyFilters = (next: PropertyFileExploreFilters) => {
    setFilters(next);
    setApplied(next);
    setPage(1);
  };

  const setFilter = (key: keyof PropertyFileExploreFilters, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const hasFilters = useMemo(
    () => Object.values(applied).some((value) => String(value).trim().length > 0),
    [applied]
  );

  const activeFilterCount = useMemo(
    () => Object.values(applied).filter((value) => String(value).trim().length > 0).length,
    [applied]
  );

  const openDetail = (propertyFileId: number) => setDetailId(propertyFileId);

  const openPropertyFile = (propertyFile: ExplorePropertyFile) => {
    const target = propertyFileCardTarget(propertyFile);
    if (target.kind === "property-file-detail") navigate("property-file-detail", target.id);
    else setDetailId(target.id);
  };

  return (
    <div role="region" aria-label="اکسپلور فایل‌ها">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters({ ...filters });
        }}
        className="mb-5"
      >
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative min-w-48 flex-1 max-w-72">
            <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={filters.q}
              onChange={(event) => setFilter("q", event.target.value)}
              aria-label="جست‌وجوی فایل‌ها"
              placeholder="جست‌وجوی عنوان فایل، ملک یا محله…"
              className="w-full rounded-xl border border-border bg-card py-2 pl-10 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((visible) => !visible)}
            aria-expanded={showFilters}
            className={
              showFilters || activeFilterCount > 0
                ? "flex items-center gap-1.5 rounded-xl border border-primary bg-primary/5 px-3 py-2 text-xs font-medium text-primary transition-colors"
                : "flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium transition-colors hover:bg-secondary"
            }
          >
            <SlidersHorizontal size={12} />
            فیلترها
            {activeFilterCount > 0 && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </button>
          {hasFilters && (
            <button
              type="button"
              onClick={() => applyFilters(EMPTY_PROPERTY_FILE_EXPLORE_FILTERS)}
              className="text-xs whitespace-nowrap text-destructive transition-colors hover:underline"
            >
              پاک کردن فیلترها
            </button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {loading ? "در حال بررسی فایل‌ها…" : `${total.toLocaleString("fa-IR")} فایل فعال از همهٔ کارشناسان`}
          </span>
        </div>

        {showFilters && (
          <Card className="p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs font-medium text-muted-foreground">
                کانال انتشار
                <select
                  value={filters.channel}
                  onChange={(event) => applyFilters({ ...filters, channel: event.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">همه کانال‌ها</option>
                  {PROPERTY_FILE_CHANNEL_CODES.map((code) => (
                    <option key={code} value={code}>{toPersianChannel(code)}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                نوع معامله
                <select
                  value={filters.dealType}
                  onChange={(event) => applyFilters({ ...filters, dealType: event.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">همه انواع معامله</option>
                  {(catalog?.dealTypes || []).map((dealType) => (
                    <option key={dealType.id} value={String(dealType.id)}>{dealType.displayName}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                نوع ملک
                <select
                  value={filters.propertyTypeRef}
                  onChange={(event) => applyFilters({ ...filters, propertyTypeRef: event.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">همه انواع ملک</option>
                  {(catalog?.propertyTypes || []).map((propertyType) => (
                    <option key={propertyType.id} value={String(propertyType.id)}>{propertyType.displayName}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                شهر
                <input
                  value={filters.city}
                  onChange={(event) => setFilter("city", event.target.value)}
                  placeholder="نام شهر"
                  className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                محله
                <input
                  value={filters.district}
                  onChange={(event) => setFilter("district", event.target.value)}
                  placeholder="نام محله"
                  className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-muted-foreground">
                  حداقل متراژ
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={filters.areaMin}
                    onChange={(event) => setFilter("areaMin", event.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  حداکثر متراژ
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={filters.areaMax}
                    onChange={(event) => setFilter("areaMax", event.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Btn type="submit" size="sm" disabled={loading}>
                <Search size={13} />
                جست‌وجو
              </Btn>
            </div>
          </Card>
        )}
      </form>

      {error && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 dark:border-red-500/35 bg-red-50 dark:bg-red-500/12 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <span>{error}</span>
          <Btn variant="secondary" size="xs" onClick={() => setRevision((value) => value + 1)}>تلاش دوباره</Btn>
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">در حال بارگذاری فایل‌ها…</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
            <Compass size={20} />
          </span>
          <p className="text-sm font-medium">فایل فعالی با این مشخصات پیدا نشد</p>
          <p className="max-w-md text-xs text-muted-foreground">
            فقط فایل‌های فعال که ملک آن‌ها آماده واگذاری یا رزرو شده است در این بخش دیده می‌شوند.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((propertyFile) => (
              <Card key={propertyFile.id} className="flex flex-col overflow-hidden">
                <div
                  className="relative flex h-36 items-end bg-gradient-to-br from-slate-700 to-slate-900 p-3"
                  style={
                    propertyFile.imageUrl
                      ? {
                          backgroundImage: `url(${propertyFile.imageUrl})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }
                      : undefined
                  }
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
                  <div className="relative z-10 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-bold text-white">
                      فعال
                    </span>
                    <span className="rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white/90">
                      {toPersianChannel(propertyFile.channel)}
                    </span>
                    <span className="rounded-full bg-card/90 px-2 py-0.5 text-[10px] font-bold text-foreground">
                      {propertyFile.isMine ? "فایل من" : "فقط‌خواندنی"}
                    </span>
                  </div>
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <h3 className="truncate text-sm font-semibold">{propertyFile.title}</h3>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{propertyFile.propertyTitle}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {(propertyFile.city || propertyFile.district) && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={11} />
                        {[propertyFile.city, propertyFile.district].filter(Boolean).join("، ")}
                      </span>
                    )}
                    {propertyFile.area > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Ruler size={11} />
                        {propertyFile.area.toLocaleString("fa-IR")} متر
                      </span>
                    )}
                    {propertyFile.propertyType && <span>{propertyFile.propertyType}</span>}
                  </div>
                  <p className="mt-2 text-xs font-bold text-primary">{propertyFilePriceLabel(propertyFile)}</p>
                  <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                    <ProfileAvatar
                      imageUrl={propertyFile.consultantAvatar}
                      initials={consultantInitials(propertyFile.consultantName)}
                      size="xs"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {propertyFile.consultantName || "کارشناس ثبت نشده"}
                    </span>
                    <Badge label={propertyFile.dealTypeDisplay || toPersianDeal(propertyFile.dealTypeName) || "—"} variant="muted" />
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Btn variant="secondary" size="sm" onClick={() => openPropertyFile(propertyFile)}>
                      <FileText size={13} />
                      جزئیات
                    </Btn>
                    <Btn variant="primary" size="sm" onClick={() => openDetail(propertyFile.id)}>
                      <Send size={13} />
                      معرفی به مشتری
                    </Btn>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <div className="mt-4 px-1">
            <Pagination
              page={page}
              total={total}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </div>
        </>
      )}

      {detailId !== null && (
        <PropertyFileDetailModal
          key={detailId}
          propertyFileId={detailId}
          onClose={() => setDetailId(null)}
          navigate={navigate}
          onIntroduced={onIntroduced}
          onRefresh={() => {
            setPage(1);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}

export { PropertyFileExplorer };
