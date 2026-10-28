import { fmtShort, normalizePriceDigits } from "./utils";

const PROPERTY_FILE_CHANNEL_CODES = ["WEBSITE", "INSTAGRAM", "TELEGRAM", "OTHER"] as const;

type PropertyFileExploreFilters = {
  q: string;
  channel: string;
  dealType: string;
  propertyTypeRef: string;
  city: string;
  district: string;
  areaMin: string;
  areaMax: string;
};

type PropertyFileMatchCriteria = {
  q: string;
  dealType: string;
  propertyTypeRef: string;
  city: string;
  district: string;
  areaMin: string;
  areaMax: string;
  saleMax: string;
  depositMax: string;
  rentMax: string;
};

type MatchDealKind = "all" | "sale" | "rent" | "mortgage";

type MatchDealTypeOption = {
  id: string | number;
  displayName: string;
  name?: string;
};

type MatchBrief = {
  dealType: string;
  propertyTypeRef: string;
  saleMaxMillion: string;
  depositMaxMillion: string;
  rentMaxMillion: string;
  areaMin: string;
  areaMax: string;
  city: string;
  district: string;
};

type PropertyFileMatchCandidate = PropertyFilePriceSource & {
  area?: number | null;
  city?: string | null;
  district?: string | null;
};

type PropertyFileMatchScore = {
  score: number;
  reasons: string[];
};

type RankedPropertyFileMatch<T extends PropertyFileMatchCandidate> = PropertyFileMatchScore & {
  propertyFile: T;
};

const EMPTY_PROPERTY_FILE_EXPLORE_FILTERS: PropertyFileExploreFilters = {
  q: "",
  channel: "",
  dealType: "",
  propertyTypeRef: "",
  city: "",
  district: "",
  areaMin: "",
  areaMax: "",
};

const EMPTY_PROPERTY_FILE_MATCH_CRITERIA: PropertyFileMatchCriteria = {
  q: "",
  dealType: "",
  propertyTypeRef: "",
  city: "",
  district: "",
  areaMin: "",
  areaMax: "",
  saleMax: "",
  depositMax: "",
  rentMax: "",
};

const EMPTY_MATCH_BRIEF: MatchBrief = {
  dealType: "",
  propertyTypeRef: "",
  saleMaxMillion: "",
  depositMaxMillion: "",
  rentMaxMillion: "",
  areaMin: "",
  areaMax: "",
  city: "",
  district: "",
};

const MATCH_MILLION = 1_000_000;

const MATCH_COMPONENT_WEIGHTS = { budget: 40, area: 35, location: 25 } as const;

type PropertyFileInquiryDraft = {
  clientName: string;
  clientPhone: string;
  message: string;
};

const EMPTY_PROPERTY_FILE_INQUIRY: PropertyFileInquiryDraft = {
  clientName: "",
  clientPhone: "",
  message: "",
};

type PropertyFilePriceSource = {
  salePrice?: string | number | null;
  deposit?: string | number | null;
  monthlyRent?: string | number | null;
  dealTypeDisplay?: string | null;
  dealTypeName?: string | null;
};

type PropertyFileExploreItem = PropertyFilePriceSource & {
  id: number;
  title: string;
  description: string;
  dealTypeId: number | null;
  propertyTitle: string;
  propertyType: string;
  area: number;
  district: string;
  city: string;
  imageUrl: string | null;
  consultantId: number | null;
  consultantName: string;
  consultantAvatar: string | null;
  channel: string;
  channelDisplay: string;
  propertyId: number;
  isMine: boolean;
};

type PropertyFileExploreAttribute = {
  name: string;
  displayName: string;
  unit: string | null;
  isFacility: boolean;
  value: unknown;
  displayValue: string | null;
};

type PropertyFileExploreDetail = PropertyFilePriceSource & {
  id: number;
  title: string;
  description: string;
  status: string;
  publishChannel: string;
  channelDisplay: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  area: number;
  propertyType: string;
  district: string;
  city: string;
  consultantName: string;
  isMine: boolean;
  property_detail: {
    id: number;
    title: string;
    district: string;
    price: string | null;
    area: number;
    floor: number | null;
    internal_code: string;
    image_url: string | null;
  } | null;
  attributeDetails: PropertyFileExploreAttribute[];
};

type PropertyFilePricePart = { label: string; value: number };

const consultantInitials = (name?: string | null): string => {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "؟";
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
};

const asAmount = (value: string | number | null | undefined): number => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const filledEntries = (source: Record<string, string>): [string, string][] =>
  Object.entries(source)
    .map(([key, value]) => [key, String(value ?? "").trim()] as [string, string])
    .filter(([, value]) => value.length > 0);

const buildPagedParams = (
  source: Record<string, string>,
  page: number,
  pageSize: number
): URLSearchParams => {
  const params = new URLSearchParams({
    page: String(Math.max(1, page)),
    page_size: String(Math.max(1, pageSize)),
  });
  filledEntries(source).forEach(([key, value]) => params.set(key, value));
  return params;
};

const buildPropertyFileExploreParams = (
  filters: PropertyFileExploreFilters,
  page: number,
  pageSize: number
): URLSearchParams => buildPagedParams({ ...filters }, page, pageSize);

const buildPropertyFileMatchParams = (
  criteria: PropertyFileMatchCriteria,
  page: number,
  pageSize: number,
  onlyMine: boolean
): URLSearchParams => {
  const params = buildPagedParams({ ...criteria }, page, pageSize);
  if (onlyMine) params.set("scope", "mine");
  return params;
};

const matchDealKind = (
  dealTypeId: string,
  dealTypes: MatchDealTypeOption[] = []
): MatchDealKind => {
  const selected = dealTypes.find((dealType) => String(dealType.id) === String(dealTypeId));
  if (!selected) return "all";
  const label = `${selected.displayName || ""} ${selected.name || ""}`.toLowerCase();
  if (/فروش|پیش|sale|pre/.test(label)) return "sale";
  if (/اجاره|rent/.test(label)) return "rent";
  if (/رهن|mortgage|deposit/.test(label)) return "mortgage";
  return "all";
};

const briefMillionToToman = (value: string): string => {
  const digits = normalizePriceDigits(value, 12);
  if (!digits) return "";
  return String(Number(digits) * MATCH_MILLION);
};

const matchBriefToCriteria = (brief: MatchBrief): PropertyFileMatchCriteria => ({
  q: "",
  dealType: brief.dealType,
  propertyTypeRef: brief.propertyTypeRef,
  city: brief.city.trim(),
  district: brief.district.trim(),
  areaMin: normalizePriceDigits(brief.areaMin, 6),
  areaMax: normalizePriceDigits(brief.areaMax, 6),
  saleMax: briefMillionToToman(brief.saleMaxMillion),
  depositMax: briefMillionToToman(brief.depositMaxMillion),
  rentMax: briefMillionToToman(brief.rentMaxMillion),
});

const matchCriteriaBudgetText = (criteria: PropertyFileMatchCriteria): string => {
  const ceilings = [
    asAmount(criteria.saleMax) ? `سقف خرید ${fmtShort(asAmount(criteria.saleMax))}` : "",
    asAmount(criteria.depositMax) ? `سقف ودیعه ${fmtShort(asAmount(criteria.depositMax))}` : "",
    asAmount(criteria.rentMax) ? `سقف اجاره ${fmtShort(asAmount(criteria.rentMax))}` : "",
  ].filter(Boolean);
  return ceilings.join(" · ");
};

const buildMatchEngineParams = (
  criteria: PropertyFileMatchCriteria,
  page: number,
  pageSize: number,
  onlyMine: boolean
): URLSearchParams => {
  const areaMin = asAmount(criteria.areaMin);
  const areaMax = asAmount(criteria.areaMax);
  const engine: Record<string, string> = {
    ...criteria,
    district: criteria.city.trim() ? "" : criteria.district,
  };

  if (areaMin && areaMax) {
    engine.areaMin = String(Math.round(areaMin * 0.85));
    engine.areaMax = String(Math.round(areaMax * 1.15));
  } else if (areaMin) {
    engine.areaMin = String(Math.round(areaMin * 0.9));
    engine.areaMax = String(Math.round(areaMin * 1.8));
  } else if (areaMax) {
    engine.areaMin = String(Math.round(areaMax * 0.6));
    engine.areaMax = String(Math.round(areaMax * 1.15));
  }

  (["saleMax", "depositMax", "rentMax"] as const).forEach((key) => {
    const ceiling = asAmount(engine[key]);
    engine[key] = ceiling ? String(Math.round(ceiling * 1.15)) : "";
  });

  const params = buildPagedParams(engine, page, pageSize);
  if (onlyMine) params.set("scope", "mine");
  return params;
};

const normalizeMatchText = (value?: string | null): string =>
  String(value || "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\u200e\u200f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const clampMatchScore = (value: number): number =>
  Math.max(20, Math.min(100, Math.round(value)));

const preferredAreaBand = (criteria: PropertyFileMatchCriteria): [number, number] | null => {
  const areaMin = asAmount(criteria.areaMin);
  const areaMax = asAmount(criteria.areaMax);
  if (areaMin && areaMax) return areaMin <= areaMax ? [areaMin, areaMax] : [areaMax, areaMin];
  if (areaMin) return [areaMin, Math.round(areaMin * 1.25)];
  if (areaMax) return [Math.round(areaMax * 0.75), areaMax];
  return null;
};

type MatchComponent = { value: number; reason: string };

const scorePropertyFileArea = (
  candidate: PropertyFileMatchCandidate,
  criteria: PropertyFileMatchCriteria
): MatchComponent | null => {
  const band = preferredAreaBand(criteria);
  if (!band) return null;
  const area = asAmount(candidate.area);
  if (!area) return null;
  const [low, high] = band;
  if (area >= low && area <= high) {
    return { value: 100, reason: "متراژ در بازهٔ درخواستی" };
  }
  const gap = area < low ? low - area : area - high;
  const span = Math.max(high - low, 1);
  return {
    value: clampMatchScore(100 - 90 * (gap / span)),
    reason: area < low ? "متراژ کمتر از درخواست" : "متراژ بیشتر از درخواست",
  };
};

const scorePropertyFileBudget = (
  candidate: PropertyFileMatchCandidate,
  criteria: PropertyFileMatchCriteria
): MatchComponent | null => {
  const ceilings = [
    [asAmount(criteria.saleMax), asAmount(candidate.salePrice)],
    [asAmount(criteria.depositMax), asAmount(candidate.deposit)],
    [asAmount(criteria.rentMax), asAmount(candidate.monthlyRent)],
  ].filter(([ceiling, price]) => ceiling > 0 && price > 0);

  if (!ceilings.length) {
    const hasCeiling = asAmount(criteria.saleMax) + asAmount(criteria.depositMax) + asAmount(criteria.rentMax) > 0;
    const hasPrice = asAmount(candidate.salePrice) + asAmount(candidate.deposit) + asAmount(candidate.monthlyRent) > 0;
    if (hasCeiling && !hasPrice) return { value: 55, reason: "قیمت توافقی" };
    return null;
  }

  const usage = Math.max(...ceilings.map(([ceiling, price]) => price / ceiling));
  return {
    value: clampMatchScore(100 - 55 * Math.max(0, usage - 0.35)),
    reason: usage <= 0.75 ? "بودجه با فضای کافی" : usage <= 1 ? "در محدودهٔ بودجه" : "کمی بالاتر از بودجه",
  };
};

const scorePropertyFileLocation = (
  candidate: PropertyFileMatchCandidate,
  criteria: PropertyFileMatchCriteria
): MatchComponent | null => {
  const city = normalizeMatchText(criteria.city);
  const district = normalizeMatchText(criteria.district);
  if (!city && !district) return null;
  const candidateCity = normalizeMatchText(candidate.city);
  const candidateDistrict = normalizeMatchText(candidate.district);
  if (district && candidateDistrict && candidateDistrict === district) {
    return { value: 100, reason: "محلهٔ یکسان" };
  }
  if (city && candidateCity && candidateCity === city) {
    return district
      ? { value: 72, reason: "همان شهر، محلهٔ دیگر" }
      : { value: 100, reason: "شهر درخواستی" };
  }
  if (city && candidateCity) return { value: 45, reason: "شهر متفاوت" };
  return null;
};

const scorePropertyFileMatch = (
  candidate: PropertyFileMatchCandidate,
  criteria: PropertyFileMatchCriteria
): PropertyFileMatchScore => {
  const rawComponents: Array<{ weight: number; result: MatchComponent | null }> = [
    { weight: MATCH_COMPONENT_WEIGHTS.budget, result: scorePropertyFileBudget(candidate, criteria) },
    { weight: MATCH_COMPONENT_WEIGHTS.area, result: scorePropertyFileArea(candidate, criteria) },
    { weight: MATCH_COMPONENT_WEIGHTS.location, result: scorePropertyFileLocation(candidate, criteria) },
  ];
  const components = rawComponents.filter(
    (component): component is { weight: number; result: MatchComponent } => component.result !== null
  );

  if (!components.length) {
    return { score: 72, reasons: ["نزدیک‌ترین گزینه به درخواست"] };
  }

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const weighted = components.reduce(
    (sum, component) => sum + component.result.value * component.weight,
    0
  );

  return {
    score: clampMatchScore(weighted / totalWeight),
    reasons: components.map((component) => component.result.reason),
  };
};

const rankPropertyFileMatches = <T extends PropertyFileMatchCandidate>(
  propertyFiles: T[],
  criteria: PropertyFileMatchCriteria
): RankedPropertyFileMatch<T>[] =>
  propertyFiles
    .map((propertyFile) => ({ propertyFile, ...scorePropertyFileMatch(propertyFile, criteria) }))
    .sort((first, second) => second.score - first.score);

const propertyFilePriceParts = (propertyFile: PropertyFilePriceSource): PropertyFilePricePart[] => {
  const dealDisplay = String(propertyFile.dealTypeDisplay || propertyFile.dealTypeName || "");
  const salePrice = asAmount(propertyFile.salePrice);
  const deposit = asAmount(propertyFile.deposit);
  const monthlyRent = asAmount(propertyFile.monthlyRent);
  const parts: PropertyFilePricePart[] = [];

  if (monthlyRent > 0) parts.push({ label: "اجاره ماهانه", value: monthlyRent });
  if (deposit > 0) {
    const rentOnly = dealDisplay.includes("رهن") && !dealDisplay.includes("اجاره");
    parts.push({ label: rentOnly ? "برای رهن" : "ودیعه", value: deposit });
  }
  if (salePrice > 0) {
    const label = dealDisplay.includes("پیش") ? "پیش‌فروش" : "قیمت فروش";
    parts.push({ label, value: salePrice });
  }
  return parts;
};

const propertyFilePriceLabel = (propertyFile: PropertyFilePriceSource): string => {
  const parts = propertyFilePriceParts(propertyFile);
  if (!parts.length) return "قیمت توافقی";
  return parts.map((part) => `${part.label} ${fmtShort(part.value)}`).join(" · ");
};

const propertyFileInquiryValidationError = (draft: PropertyFileInquiryDraft): string | null => {
  if (!draft.clientName.trim() && !draft.message.trim()) {
    return "نام مشتری یا متن یادداشت را وارد کنید.";
  }
  return null;
};

const buildPropertyFileInquiryPayload = (
  propertyFileId: number | string,
  draft: PropertyFileInquiryDraft
): { propertyFileId: number | string; clientName: string; clientPhone: string; message: string } => ({
  propertyFileId,
  clientName: draft.clientName.trim(),
  clientPhone: draft.clientPhone.trim(),
  message: draft.message.trim(),
});

export {
  PROPERTY_FILE_CHANNEL_CODES,
  EMPTY_PROPERTY_FILE_EXPLORE_FILTERS,
  EMPTY_PROPERTY_FILE_MATCH_CRITERIA,
  EMPTY_MATCH_BRIEF,
  matchDealKind,
  matchBriefToCriteria,
  matchCriteriaBudgetText,
  buildMatchEngineParams,
  normalizeMatchText,
  scorePropertyFileMatch,
  rankPropertyFileMatches,
  EMPTY_PROPERTY_FILE_INQUIRY,
  consultantInitials,
  buildPropertyFileExploreParams,
  buildPropertyFileMatchParams,
  propertyFilePriceParts,
  propertyFilePriceLabel,
  propertyFileInquiryValidationError,
  buildPropertyFileInquiryPayload,
};

export type {
  PropertyFileExploreFilters,
  PropertyFileMatchCriteria,
  MatchBrief,
  MatchDealKind,
  MatchDealTypeOption,
  PropertyFileMatchCandidate,
  PropertyFileMatchScore,
  RankedPropertyFileMatch,
  PropertyFileInquiryDraft,
  PropertyFilePriceSource,
  PropertyFilePricePart,
  PropertyFileExploreItem,
  PropertyFileExploreAttribute,
  PropertyFileExploreDetail,
};
