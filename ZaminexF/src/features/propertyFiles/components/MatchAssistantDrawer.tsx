import React, { useEffect, useMemo, useRef, useState } from "react";
import { Btn } from "../../../shared/components/ui/Btn";
import { ProfileAvatar } from "../../../shared/components/ui/ProfileAvatar";
import type { Role } from "../../../shared/lib/types";
import type { Catalog } from "../../../shared/lib/useAttributeSchema";
import { apiErrorMessage, apiFetch, readJson } from "../../../shared/lib/apiClient";
import {
  cx,
  formatPriceToPersianWords,
  formatPriceWithCommas,
  normalizePriceDigits,
} from "../../../shared/lib/utils";
import {
  EMPTY_MATCH_BRIEF,
  buildMatchEngineParams,
  consultantInitials,
  propertyFilePriceLabel,
  matchBriefToCriteria,
  matchCriteriaBudgetText,
  matchDealKind,
  rankPropertyFileMatches,
} from "../../../shared/lib/propertyFileExplore";
import type {
  PropertyFileExploreItem as ExplorePropertyFile,
  PropertyFileMatchCriteria,
  MatchBrief,
  MatchDealTypeOption,
  RankedPropertyFileMatch,
} from "../../../shared/lib/propertyFileExplore";
import {
  BrainCircuit,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  FileText,
  Loader2,
  MapPin,
  Ruler,
  Sparkles,
  Target,
  Wallet,
  WandSparkles,
  X,
} from "lucide-react";

const CANDIDATE_PAGE_SIZE = 100;
const CANDIDATE_PAGE_LIMIT = 5;
const RESULT_PAGE_SIZE = 8;

const MATCH_STEPS = [
  { title: "نوع معامله", question: "دنبال چه نوع معامله‌ای هستید؟" },
  { title: "بودجه", question: "سقف بودجهٔ مشتری چقدر است؟" },
  { title: "متراژ", question: "مشتری چه متراژی می‌خواهد؟" },
  { title: "موقعیت", question: "کدام شهر و محله مدنظر است؟" },
];

const AREA_PRESETS = [
  { label: "۵۰ تا ۸۰ متر", min: "50", max: "80" },
  { label: "۸۰ تا ۱۲۰ متر", min: "80", max: "120" },
  { label: "۱۲۰ تا ۱۵۰ متر", min: "120", max: "150" },
  { label: "بیش از ۱۵۰ متر", min: "150", max: "" },
  { label: "بدون محدودیت", min: "", max: "" },
];

const persianNumber = (value: number | string): string =>
  Number(value || 0).toLocaleString("fa-IR");

const budgetPreview = (value: string): string => {
  const digits = normalizePriceDigits(value, 12);
  if (!digits) return "";
  return formatPriceToPersianWords(Number(digits) * 1_000_000);
};

const summarizeCriteria = (
  criteria: PropertyFileMatchCriteria,
  dealTypes: MatchDealTypeOption[],
  propertyTypes: MatchDealTypeOption[],
  emptyDealLabel: string
): string[] => {
  const chips: string[] = [];
  const deal = dealTypes.find((item) => String(item.id) === String(criteria.dealType));
  chips.push(deal?.displayName || emptyDealLabel);
  const property = propertyTypes.find((item) => String(item.id) === String(criteria.propertyTypeRef));
  if (property) chips.push(property.displayName);
  matchCriteriaBudgetText(criteria)
    .split(" · ")
    .filter(Boolean)
    .forEach((part) => chips.push(part));
  const areaMin = Number(criteria.areaMin || 0);
  const areaMax = Number(criteria.areaMax || 0);
  if (areaMin && areaMax) chips.push(`${persianNumber(areaMin)} تا ${persianNumber(areaMax)} متر`);
  else if (areaMin) chips.push(`از ${persianNumber(areaMin)} متر`);
  else if (areaMax) chips.push(`تا ${persianNumber(areaMax)} متر`);
  const place = [criteria.city, criteria.district].filter(Boolean).join("، ");
  if (place) chips.push(place);
  return chips;
};

const scoreTone = (score: number): string => {
  if (score >= 85) return "text-emerald-700 dark:text-emerald-300";
  if (score >= 70) return "text-purple-700 dark:text-purple-300";
  return "text-amber-700 dark:text-amber-300";
};

const scoreRing = (score: number): string => {
  const color = score >= 85 ? "var(--chart-1)" : score >= 70 ? "var(--chart-4)" : "var(--chart-3)";
  return `conic-gradient(${color} ${score * 3.6}deg, color-mix(in srgb, var(--border) 75%, transparent) 0deg)`;
};

async function fetchMatchPage(
  params: URLSearchParams,
  signal: AbortSignal
): Promise<{ results: ExplorePropertyFile[]; count: number }> {
  const response = await apiFetch(`/property-files/api/property-files/recommendations/?${params.toString()}`, {
    method: "GET",
    signal,
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(apiErrorMessage(data, "دریافت پیشنهادها انجام نشد."));
  }
  return {
    results: Array.isArray(data?.results) ? (data.results as ExplorePropertyFile[]) : [],
    count: Number(data?.count || 0),
  };
}

function MatchAssistantDrawer({
  open,
  onClose,
  onOpenPropertyFile,
  catalog,
  role,
  refreshKey = 0,
  suspended = false,
}: {
  open: boolean;
  onClose: () => void;
  onOpenPropertyFile: (propertyFile: ExplorePropertyFile) => void;
  catalog?: Catalog | null;
  role?: Role;
  refreshKey?: number;
  suspended?: boolean;
}) {
  const dealTypes = (catalog?.dealTypes || []) as MatchDealTypeOption[];
  const propertyTypes = (catalog?.propertyTypes || []) as MatchDealTypeOption[];
  const canFilterMine = role !== "admin";

  const [step, setStep] = useState(0);
  const [brief, setBrief] = useState<MatchBrief>(EMPTY_MATCH_BRIEF);
  const [criteria, setCriteria] = useState<PropertyFileMatchCriteria | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [runRevision, setRunRevision] = useState(0);
  const [ranked, setRanked] = useState<RankedPropertyFileMatch<ExplorePropertyFile>[]>([]);
  const [engineTotal, setEngineTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultPage, setResultPage] = useState(1);
  const mineOnly = canFilterMine && onlyMine;

  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (suspendedRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const elements = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex="0"]'
      ));
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) {
        event.preventDefault();
        panelRef.current.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || suspended) return;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
  }, [open, suspended]);

  useEffect(() => {
    if (!criteria) return;
    const controller = new AbortController();
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const first = await fetchMatchPage(
          buildMatchEngineParams(criteria, 1, CANDIDATE_PAGE_SIZE, mineOnly),
          controller.signal
        );
        const pages = Math.min(
          Math.max(1, Math.ceil(Number(first.count || 0) / CANDIDATE_PAGE_SIZE)),
          CANDIDATE_PAGE_LIMIT
        );
        const rows = [...first.results];
        if (pages > 1) {
          const rest = await Promise.all(
            Array.from({ length: pages - 1 }, (_, index) =>
              fetchMatchPage(
                buildMatchEngineParams(criteria, index + 2, CANDIDATE_PAGE_SIZE, mineOnly),
                controller.signal
              ).catch(() => null)
            )
          );
          rest.forEach((page) => {
            if (page) rows.push(...page.results);
          });
        }
        if (!active || controller.signal.aborted) return;
        setRanked(rankPropertyFileMatches(rows, criteria));
        setEngineTotal(Number(first.count || 0));
        setResultPage(1);
      } catch (reason: any) {
        if (!active || controller.signal.aborted) return;
        setRanked([]);
        setEngineTotal(0);
        setError(reason?.message || "در تحلیل فایل‌ها خطایی رخ داد.");
      } finally {
        if (active && !controller.signal.aborted) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [criteria, mineOnly, refreshKey, runRevision]);

  const dealKind = matchDealKind(brief.dealType, dealTypes);
  const areaMinValue = Number(normalizePriceDigits(brief.areaMin, 6) || 0);
  const areaMaxValue = Number(normalizePriceDigits(brief.areaMax, 6) || 0);
  const areaError =
    areaMinValue > 0 && areaMaxValue > 0 && areaMaxValue < areaMinValue
      ? "حداکثر متراژ باید بزرگ‌تر از حداقل باشد."
      : null;

  const draftCriteria = useMemo(() => matchBriefToCriteria(brief), [brief]);
  const draftChips = useMemo(
    () => summarizeCriteria(draftCriteria, dealTypes, propertyTypes, "همهٔ معاملات"),
    [draftCriteria, dealTypes, propertyTypes]
  );

  if (!open) return null;

  const setBriefField = (key: keyof MatchBrief, value: string) =>
    setBrief((current) => ({ ...current, [key]: value }));

  const selectDealType = (value: string) => {
    const kind = matchDealKind(value, dealTypes);
    setBrief((current) => ({
      ...current,
      dealType: value,
      saleMaxMillion: kind === "sale" || kind === "all" ? current.saleMaxMillion : "",
      depositMaxMillion: kind === "sale" ? "" : current.depositMaxMillion,
      rentMaxMillion: kind === "rent" || kind === "all" ? current.rentMaxMillion : "",
    }));
  };

  const startOver = () => {
    setStep(0);
    setBrief(EMPTY_MATCH_BRIEF);
    setCriteria(null);
    setRanked([]);
    setEngineTotal(0);
    setError(null);
  };

  const editCriteria = () => {
    setCriteria(null);
    setStep(0);
  };

  const goNext = () => {
    if (step === 2 && areaError) return;
    if (step < MATCH_STEPS.length - 1) {
      setStep((current) => current + 1);
      return;
    }
    setCriteria(matchBriefToCriteria(brief));
  };

  const totalResultPages = Math.max(1, Math.ceil(ranked.length / RESULT_PAGE_SIZE));
  const safeResultPage = Math.min(resultPage, totalResultPages);
  const visibleResults = ranked.slice(
    (safeResultPage - 1) * RESULT_PAGE_SIZE,
    safeResultPage * RESULT_PAGE_SIZE
  );

  const budgetFields: Array<{
    key: keyof MatchBrief;
    label: string;
    placeholder: string;
    presets: string[];
  }> = [];
  if (dealKind === "sale" || dealKind === "all") {
    budgetFields.push({
      key: "saleMaxMillion",
      label: "سقف بودجهٔ خرید",
      placeholder: "مثلاً ۱۲۰۰۰",
      presets: ["3000", "5000", "8000", "12000", "20000"],
    });
  }
  if (dealKind === "rent" || dealKind === "mortgage" || dealKind === "all") {
    budgetFields.push({
      key: "depositMaxMillion",
      label: "سقف ودیعه",
      placeholder: "مثلاً ۵۰۰",
      presets: ["100", "300", "500", "1000"],
    });
  }
  if (dealKind === "rent" || dealKind === "all") {
    budgetFields.push({
      key: "rentMaxMillion",
      label: "سقف اجارهٔ ماهانه",
      placeholder: "مثلاً ۳۰",
      presets: ["10", "20", "30", "50"],
    });
  }

  return (
    <div
      role="presentation"
      onClick={onClose}
      aria-hidden={suspended || undefined}
      className="fixed inset-0 z-40 flex justify-end bg-slate-950/45 backdrop-blur-sm"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="دستیار تطبیقی"
        onClick={(event) => event.stopPropagation()}
        dir="rtl"
        className="flex h-full w-full max-w-xl animate-in flex-col border-l border-purple-200/60 bg-card shadow-2xl outline-none duration-300 slide-in-from-right dark:border-purple-500/25"
      >
        <div className="relative flex-shrink-0 overflow-hidden bg-gradient-to-br from-purple-600 via-violet-600 to-fuchsia-600 px-5 py-5 text-white">
          <div className="pointer-events-none absolute -left-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-12 right-10 h-28 w-28 rounded-full bg-fuchsia-300/20 blur-2xl" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15 shadow-inner ring-1 ring-white/25">
                <WandSparkles size={22} />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold">دستیار تطبیقی</h2>
                  <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold ring-1 ring-white/25">
                    تحلیل هوشمند
                  </span>
                </div>
                <p className="mt-1 max-w-sm text-[11px] leading-5 text-white/80">
                  نیاز مشتری را در چند گام کوتاه مشخص کنید؛ فایل‌های فعال با درصد تطبیق و دلیل مرتب می‌شوند.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="بستن دستیار تطبیقی"
              className="flex-shrink-0 rounded-lg p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {criteria ? (
          <>
            <div className="flex-shrink-0 border-b border-border bg-card px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {summarizeCriteria(criteria, dealTypes, propertyTypes, "همهٔ معاملات").map((chip) => (
                    <span
                      key={chip}
                      className="inline-flex items-center gap-1 rounded-full border border-purple-200/80 bg-purple-50 px-2.5 py-1 text-[11px] font-medium text-purple-700 dark:border-purple-500/30 dark:bg-purple-500/12 dark:text-purple-300"
                    >
                      <Check size={10} />
                      {chip}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={editCriteria}
                  className="text-[11px] font-medium text-primary transition hover:underline"
                >
                  ویرایش معیارها
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  {loading
                    ? "در حال امتیازدهی به فایل‌ها…"
                    : engineTotal > ranked.length
                      ? `${persianNumber(ranked.length)} فایل از ${persianNumber(engineTotal)} نتیجه بررسی و بر اساس امتیاز تطبیق مرتب شد`
                      : `${persianNumber(ranked.length)} فایل بررسی و بر اساس امتیاز تطبیق مرتب شد`}
                </p>
                <div className="flex items-center gap-3">
                  {canFilterMine && (
                    <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] font-medium">
                      <input
                        type="checkbox"
                        checked={onlyMine}
                        onChange={(event) => setOnlyMine(event.target.checked)}
                        className="h-3.5 w-3.5 rounded"
                      />
                      فقط فایل‌های خودم
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={startOver}
                    className="text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
                  >
                    شروع دوباره
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {error && (
                <div
                  role="alert"
                  className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-3 text-xs text-red-700 dark:border-red-500/35 dark:bg-red-500/12 dark:text-red-300"
                >
                  <p>{error}</p>
                  <Btn
                    type="button"
                    variant="secondary"
                    size="xs"
                    className="mt-2"
                    onClick={() => setRunRevision((value) => value + 1)}
                  >
                    تلاش دوباره
                  </Btn>
                </div>
              )}

              {loading ? (
                <div className="flex flex-col items-center gap-3 py-16 text-center text-xs text-muted-foreground">
                  <Loader2 size={22} className="animate-spin text-purple-500 dark:text-purple-400" />
                  در حال بررسی فایل‌های فعال و محاسبهٔ امتیاز…
                </div>
              ) : ranked.length === 0 && !error ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-secondary/20 py-14 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300">
                    <Target size={22} />
                  </span>
                  <p className="text-sm font-semibold">فایل فعالی با این مشخصات پیدا نشد</p>
                  <p className="max-w-sm text-[11px] leading-5 text-muted-foreground">
                    بازهٔ متراژ یا سقف بودجه را کمی بازتر کنید تا گزینه‌های نزدیک‌تر هم بررسی شوند.
                  </p>
                  <Btn type="button" variant="secondary" size="xs" onClick={editCriteria}>
                    ویرایش معیارها
                  </Btn>
                </div>
              ) : (
                <>
                  <ul className="space-y-2.5">
                    {visibleResults.map((entry, index) => {
                      const propertyFile = entry.propertyFile;
                      const rank = (safeResultPage - 1) * RESULT_PAGE_SIZE + index + 1;
                      return (
                        <li key={propertyFile.id}>
                          <button
                            type="button"
                            onClick={() => onOpenPropertyFile(propertyFile)}
                            className="group flex w-full items-stretch gap-3 rounded-2xl border border-border bg-card p-3 text-right transition hover:border-purple-300 hover:shadow-md hover:shadow-purple-500/10 dark:hover:border-purple-500/40"
                          >
                            <span className="flex flex-col items-center gap-2">
                              <span
                                className="flex h-12 w-12 items-center justify-center rounded-full p-[3px]"
                                style={{ background: scoreRing(entry.score) }}
                              >
                                <span className={cx("flex h-full w-full items-center justify-center rounded-full bg-card text-[11px] font-extrabold", scoreTone(entry.score))}>
                                  {persianNumber(entry.score)}٪
                                </span>
                              </span>
                              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                                رتبهٔ {persianNumber(rank)}
                              </span>
                            </span>

                            <span className="min-w-0 flex-1">
                              <span className="flex items-start justify-between gap-2">
                                <span className="line-clamp-2 text-sm font-semibold text-foreground">
                                  {propertyFile.title}
                                </span>
                                {rank === 1 && (
                                  <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-gradient-to-l from-purple-600 to-violet-600 px-2 py-0.5 text-[9px] font-bold text-white">
                                    <Sparkles size={9} />
                                    بهترین گزینه
                                  </span>
                                )}
                              </span>
                              <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                                {propertyFile.propertyTitle}
                              </span>
                              <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                                {(propertyFile.city || propertyFile.district) && (
                                  <span className="inline-flex items-center gap-1">
                                    <MapPin size={10} />
                                    {[propertyFile.city, propertyFile.district].filter(Boolean).join("، ")}
                                  </span>
                                )}
                                {propertyFile.area > 0 && (
                                  <span className="inline-flex items-center gap-1">
                                    <Ruler size={10} />
                                    {persianNumber(propertyFile.area)} متر
                                  </span>
                                )}
                                {propertyFile.propertyType && <span>{propertyFile.propertyType}</span>}
                              </span>
                              <span className="mt-2 flex flex-wrap gap-1">
                                {entry.reasons.map((reason) => (
                                  <span
                                    key={reason}
                                    className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300"
                                  >
                                    <CircleCheck size={9} />
                                    {reason}
                                  </span>
                                ))}
                              </span>
                              <span className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
                                <span className="truncate text-[11px] font-bold text-primary">
                                  {propertyFilePriceLabel(propertyFile)}
                                </span>
                                <span className="flex flex-shrink-0 items-center gap-1.5">
                                  <ProfileAvatar
                                    imageUrl={propertyFile.consultantAvatar}
                                    initials={consultantInitials(propertyFile.consultantName)}
                                    size="xs"
                                  />
                                  <span className="max-w-24 truncate text-[10px] text-muted-foreground">
                                    {propertyFile.consultantName || "کارشناس ثبت نشده"}
                                  </span>
                                  <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-semibold text-foreground">
                                    {propertyFile.isMine ? "فایل من" : "فقط‌خواندنی"}
                                  </span>
                                </span>
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {totalResultPages > 1 && (
                    <div className="mt-4 flex items-center justify-center gap-3">
                      <Btn
                        type="button"
                        variant="secondary"
                        size="xs"
                        disabled={safeResultPage <= 1}
                        onClick={() => setResultPage((current) => Math.max(1, current - 1))}
                      >
                        <ChevronRight size={12} />
                        قبلی
                      </Btn>
                      <span className="text-[11px] text-muted-foreground">
                        صفحهٔ {persianNumber(safeResultPage)} از {persianNumber(totalResultPages)}
                      </span>
                      <Btn
                        type="button"
                        variant="secondary"
                        size="xs"
                        disabled={safeResultPage >= totalResultPages}
                        onClick={() => setResultPage((current) => Math.min(totalResultPages, current + 1))}
                      >
                        بعدی
                        <ChevronLeft size={12} />
                      </Btn>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex-shrink-0 border-t border-border bg-secondary/20 px-5 py-3">
              <p className="flex items-start gap-1.5 text-[10px] leading-4 text-muted-foreground">
                <BrainCircuit size={12} className="mt-0.5 flex-shrink-0 text-purple-500 dark:text-purple-400" />
                امتیاز تطبیق با همان موتور جست‌وجوی فایل‌ها محاسبه می‌شود؛ فایل‌ها کمی بازتر از معیارها بررسی و سپس بر پایهٔ بودجه، متراژ و موقعیت مرتب می‌شوند.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="flex-shrink-0 px-5 pt-4">
              <div className="flex items-center">
                {MATCH_STEPS.map((item, index) => (
                  <div key={item.title} className="flex flex-1 items-center last:flex-none">
                    <span
                      className={cx(
                        "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition",
                        index < step
                          ? "bg-purple-600 text-white"
                          : index === step
                            ? "bg-purple-100 text-purple-700 ring-2 ring-purple-400 dark:bg-purple-500/20 dark:text-purple-200"
                            : "bg-secondary text-muted-foreground"
                      )}
                    >
                      {index < step ? <Check size={12} /> : persianNumber(index + 1)}
                    </span>
                    {index < MATCH_STEPS.length - 1 && (
                      <span
                        className={cx(
                          "mx-1.5 h-0.5 flex-1 rounded-full transition",
                          index < step ? "bg-purple-400" : "bg-border"
                        )}
                      />
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] font-medium text-muted-foreground">
                گام {persianNumber(step + 1)} از {persianNumber(MATCH_STEPS.length)} · {MATCH_STEPS[step].title}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <h3 className="text-sm font-bold text-foreground">{MATCH_STEPS[step].question}</h3>

              {step === 0 && (
                <div className="mt-3 space-y-4">
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    نوع معامله را انتخاب کنید تا گام بودجه با همان نوع هماهنگ شود.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => selectDealType("")}
                      className={cx(
                        "flex flex-col items-start gap-1 rounded-2xl border p-3 text-right transition",
                        brief.dealType === ""
                          ? "border-purple-400 bg-purple-50 ring-2 ring-purple-300 dark:border-purple-500/50 dark:bg-purple-500/12 dark:ring-purple-500/30"
                          : "border-border bg-card hover:border-purple-200 dark:hover:border-purple-500/40 hover:bg-purple-50/40 dark:hover:bg-purple-500/5"
                      )}
                    >
                      <span className="text-sm font-semibold">همهٔ معاملات</span>
                      <span className="text-[10px] text-muted-foreground">بدون محدودیت در نوع معامله</span>
                    </button>
                    {dealTypes.map((dealType) => (
                      <button
                        key={dealType.id}
                        type="button"
                        onClick={() => selectDealType(String(dealType.id))}
                        className={cx(
                          "flex flex-col items-start gap-1 rounded-2xl border p-3 text-right transition",
                          String(dealType.id) === brief.dealType
                            ? "border-purple-400 bg-purple-50 ring-2 ring-purple-300 dark:border-purple-500/50 dark:bg-purple-500/12 dark:ring-purple-500/30"
                            : "border-border bg-card hover:border-purple-200 dark:hover:border-purple-500/40 hover:bg-purple-50/40 dark:hover:bg-purple-500/5"
                        )}
                      >
                        <span className="text-sm font-semibold">{dealType.displayName}</span>
                        <span className="text-[10px] text-muted-foreground">فایل‌های فعال این نوع معامله</span>
                      </button>
                    ))}
                  </div>

                  {propertyTypes.length > 0 && (
                    <div>
                      <p className="mb-2 text-[11px] font-medium text-muted-foreground">نوع ملک (اختیاری)</p>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => setBriefField("propertyTypeRef", "")}
                          className={cx(
                            "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                            brief.propertyTypeRef === ""
                              ? "border-purple-400 bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-200"
                              : "border-border bg-card text-muted-foreground hover:border-purple-200 dark:hover:border-purple-500/40"
                          )}
                        >
                          همه
                        </button>
                        {propertyTypes.map((propertyType) => (
                          <button
                            key={propertyType.id}
                            type="button"
                            onClick={() => setBriefField("propertyTypeRef", String(propertyType.id))}
                            className={cx(
                              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                              String(propertyType.id) === brief.propertyTypeRef
                                ? "border-purple-400 bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-200"
                                : "border-border bg-card text-muted-foreground hover:border-purple-200 dark:hover:border-purple-500/40"
                            )}
                          >
                            {propertyType.displayName}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step === 1 && (
                <div className="mt-3 space-y-4">
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    {dealKind === "rent"
                      ? "ودیعه و اجارهٔ ماهانه را به میلیون تومان وارد کنید. هر دو مورد اختیاری است."
                      : dealKind === "mortgage"
                        ? "سقف ودیعه را به میلیون تومان وارد کنید. خالی گذاشتن یعنی بدون سقف."
                        : dealKind === "sale"
                          ? "سقف بودجهٔ خرید را به میلیون تومان وارد کنید. خالی گذاشتن یعنی بدون سقف."
                          : "برای هر بخشی که محدودیت دارید سقف را به میلیون تومان وارد کنید."}
                  </p>
                  <div className="rounded-2xl border border-purple-200/70 bg-purple-50/50 p-3 dark:border-purple-500/25 dark:bg-purple-500/8">
                    <div className="flex items-start gap-2 text-[10px] leading-5 text-purple-800 dark:text-purple-200">
                      <Wallet size={13} className="mt-0.5 flex-shrink-0" />
                      <span>
                        برای نمونه «۱۲۰۰۰» یعنی دوازده هزار میلیون تومان؛ معادل دوازده میلیارد تومان.
                      </span>
                    </div>
                  </div>

                  {budgetFields.map((field) => (
                    <div key={field.key}>
                      <label className="block">
                        <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
                        <span className="mt-1.5 flex items-center rounded-xl border border-border bg-card focus-within:ring-2 focus-within:ring-purple-300">
                          <input
                            value={formatPriceWithCommas(brief[field.key])}
                            onChange={(event) =>
                              setBriefField(field.key, normalizePriceDigits(event.target.value, 12))
                            }
                            inputMode="numeric"
                            placeholder={field.placeholder}
                            className="w-full bg-transparent px-3 py-2.5 text-sm font-semibold text-foreground outline-none"
                          />
                          <span className="whitespace-nowrap px-3 text-[10px] text-muted-foreground">میلیون تومان</span>
                        </span>
                      </label>
                      <div className="mt-1 flex min-h-4 flex-wrap items-center gap-1.5">
                        {budgetPreview(brief[field.key]) && (
                          <span className="text-[10px] font-medium text-purple-700 dark:text-purple-300">
                            {budgetPreview(brief[field.key])}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {field.presets.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setBriefField(field.key, preset)}
                            className={cx(
                              "rounded-full border px-2 py-0.5 text-[10px] transition",
                              brief[field.key] === preset
                                ? "border-purple-400 bg-purple-100 font-semibold text-purple-700 dark:bg-purple-500/20 dark:text-purple-200"
                                : "border-border bg-card text-muted-foreground hover:border-purple-200 dark:hover:border-purple-500/40"
                            )}
                          >
                            {persianNumber(preset)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {step === 2 && (
                <div className="mt-3 space-y-4">
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    بازهٔ متراژ را مشخص کنید؛ فایل‌های کمی بزرگ‌تر و کوچک‌تر هم بررسی می‌شوند اما امتیاز کمتری می‌گیرند.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-xs font-medium text-muted-foreground">از متراژ</span>
                      <span className="mt-1.5 flex items-center rounded-xl border border-border bg-card focus-within:ring-2 focus-within:ring-purple-300">
                        <input
                          value={brief.areaMin}
                          onChange={(event) => setBriefField("areaMin", normalizePriceDigits(event.target.value, 4))}
                          inputMode="numeric"
                          placeholder="۸۰"
                          className="w-full bg-transparent px-3 py-2.5 text-sm font-semibold outline-none"
                        />
                        <span className="px-3 text-[10px] text-muted-foreground">متر</span>
                      </span>
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-muted-foreground">تا متراژ</span>
                      <span className="mt-1.5 flex items-center rounded-xl border border-border bg-card focus-within:ring-2 focus-within:ring-purple-300">
                        <input
                          value={brief.areaMax}
                          onChange={(event) => setBriefField("areaMax", normalizePriceDigits(event.target.value, 4))}
                          inputMode="numeric"
                          placeholder="۱۲۰"
                          className="w-full bg-transparent px-3 py-2.5 text-sm font-semibold outline-none"
                        />
                        <span className="px-3 text-[10px] text-muted-foreground">متر</span>
                      </span>
                    </label>
                  </div>
                  {areaError && (
                    <p role="alert" className="text-[11px] font-medium text-red-600 dark:text-red-300">
                      {areaError}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {AREA_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() =>
                          setBrief((current) => ({ ...current, areaMin: preset.min, areaMax: preset.max }))
                        }
                        className={cx(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                          brief.areaMin === preset.min && brief.areaMax === preset.max
                            ? "border-purple-400 bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-200"
                            : "border-border bg-card text-muted-foreground hover:border-purple-200 dark:hover:border-purple-500/40"
                        )}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="mt-3 space-y-4">
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    شهر را وارد کنید تا جست‌وجو روی همان شهر انجام شود. محله اختیاری است و به امتیاز تطبیق اضافه می‌شود.
                  </p>
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">شهر</span>
                    <span className="mt-1.5 flex items-center gap-2 rounded-xl border border-border bg-card px-3 focus-within:ring-2 focus-within:ring-purple-300">
                      <MapPin size={14} className="flex-shrink-0 text-purple-500 dark:text-purple-400" />
                      <input
                        value={brief.city}
                        onChange={(event) => setBriefField("city", event.target.value)}
                        placeholder="مثلاً تهران"
                        className="w-full bg-transparent py-2.5 text-sm outline-none"
                      />
                    </span>
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">محله</span>
                    <span className="mt-1.5 flex items-center gap-2 rounded-xl border border-border bg-card px-3 focus-within:ring-2 focus-within:ring-purple-300">
                      <Target size={14} className="flex-shrink-0 text-purple-500 dark:text-purple-400" />
                      <input
                        value={brief.district}
                        onChange={(event) => setBriefField("district", event.target.value)}
                        placeholder="مثلاً سعادت‌آباد"
                        className="w-full bg-transparent py-2.5 text-sm outline-none"
                      />
                    </span>
                  </label>

                  {draftChips.length > 0 && (
                    <div className="rounded-2xl border border-purple-200/70 bg-gradient-to-br from-purple-50/70 to-white p-3 dark:border-purple-500/25 dark:from-purple-500/8 dark:to-card">
                      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold text-purple-700 dark:text-purple-300">
                        <Sparkles size={11} />
                        خلاصهٔ درخواست
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {draftChips.map((chip) => (
                          <span
                            key={chip}
                            className="rounded-full border border-purple-200 bg-card px-2 py-0.5 text-[10px] text-foreground dark:border-purple-500/30"
                          >
                            {chip}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex-shrink-0 border-t border-border bg-card px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <Btn
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => (step === 0 ? onClose() : setStep((current) => current - 1))}
                >
                  {step === 0 ? (
                    "انصراف"
                  ) : (
                    <>
                      <ChevronRight size={14} />
                      مرحلهٔ قبل
                    </>
                  )}
                </Btn>
                <Btn
                  type="button"
                  size="sm"
                  disabled={step === 2 && !!areaError}
                  onClick={goNext}
                  className="bg-gradient-to-l from-purple-600 via-violet-600 to-fuchsia-600 text-white shadow-md shadow-purple-500/25 hover:opacity-95"
                >
                  {step < MATCH_STEPS.length - 1 ? (
                    <>
                      ادامه
                      <ChevronLeft size={14} />
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} />
                      تحلیل و پیشنهاد فایل
                    </>
                  )}
                </Btn>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <FileText size={11} className="flex-shrink-0" />
                این دستیار فقط پیشنهاد می‌دهد؛ برای معرفی مشتری از دکمهٔ «معرفی به مشتری» در جزئیات هر فایل استفاده کنید.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { MatchAssistantDrawer };
