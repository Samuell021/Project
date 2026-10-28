import type { BadgeV, Role } from "../../../shared/lib/types";

export type SupplyStage =
  | "reception"
  | "assignment"
  | "acceptance"
  | "appraisal"
  | "review"
  | "listing"
  | "closed";

export type WizardStepKey =
  | "lead"
  | "reception"
  | "assignment"
  | "acceptance"
  | "appraisal"
  | "review"
  | "listing";

export type DealTermField = {
  key: string;
  label: string;
  type: "integer" | "decimal" | "text" | "boolean" | "date";
  unit?: string;
  required: boolean;
};

export type DealTermsSchema = {
  fields: DealTermField[];
};

export type DealTypeCatalogItem = {
  id: number;
  name: string;
  display_name: string;
  family: string;
  is_active: boolean;
  published_version?: {
    id: number;
    version_number: number;
    family: string;
    terms_schema: DealTermsSchema;
  } | null;
};

export type PropertyPartyRow = {
  id?: number;
  contactId?: number;
  fullName: string;
  phone: string;
  role: "OWNER" | "OWNER_REPRESENTATIVE" | "REPRESENTATIVE";
  sharePercent?: string | null;
  isPrimary?: boolean;
};

export type PropertyAppraisalSummary = {
  id?: number;
  report_text: string;
  visit_notes: string;
  findings: Record<string, string | number | boolean | null>;
  is_complete: boolean;
  archived_reports?: Array<{
    archived_at?: string;
    report_text?: string;
    visit_notes?: string;
    reopen_reason?: string;
  }>;
  updated_at?: string | null;
};

export type PropertyCaseRecord = {
  id: number;
  code: string;
  contact: number;
  contact_name: string;
  contact_phones?: string[];
  scope: number;
  scope_name: string;
  sales_range: number;
  sales_range_name: string;
  lead_source?: string;
  lead_source_display?: string;
  lead_status: string;
  acceptance_status: string;
  status: string;
  stage: SupplyStage;
  assigned_to: number | null;
  assigned_to_name?: string;
  assigned_at?: string | null;
  due_at?: string | null;
  accepted_at?: string | null;
  property_title: string;
  description: string;
  desired_deal_type_ids?: number[];
  resulting_property?: number | null;
  property_id?: number;
  resulting_property_code?: string;
  property_review_status?: string;
  appraisal?: PropertyAppraisalSummary | null;
  duplicate_of?: number | null;
  closure_reason?: string;
  version: number;
  created_at?: string;
  updated_at?: string;
};

export type PropertyReviewQueueItem = {
  id: number;
  property: number;
  property_code: string;
  property_title: string;
  property_area?: string | number | null;
  property_district?: string;
  property_address?: string;
  property_type_display?: string;
  registration_request: number | null;
  case_code: string;
  case_version?: number | null;
  scope_name?: string;
  assignee_name?: string;
  appraisal_summary?: PropertyAppraisalSummary | null;
  version: number;
  current_review_version?: number;
  version_drift: boolean;
  submitted_by: number | null;
  submitted_by_name: string;
  submitted_at: string;
  decision: "PENDING" | "APPROVED" | "CHANGES_REQUIRED";
  decision_display: string;
  reviewed_by_name?: string;
  reviewed_at?: string | null;
  reason: string;
  snapshot?: {
    title?: string | null;
    property_title?: string | null;
    address?: string | null;
    neighborhood?: string | null;
    district_id?: number | null;
    area?: number | null;
    rooms?: number | null;
    floor?: number | null;
    built_year?: number | null;
    property_type?: string | null;
    province_name?: string | null;
    city_name?: string | null;
    location_path?: string | null;
    latitude?: string | null;
    longitude?: string | null;
    property_type_ref_id?: number | null;
    property_type_display?: string | null;
    property_type_ref_name?: string | null;
    property_usage_id?: number | null;
    property_usage_name?: string | null;
    attributes?: Array<{ id: number; name: string; display_name: string; value: unknown; display_value: string }>;
    images?: Array<{ id: number; sort_order: number; url: string }>;
  };
};

export type WizardStepDefinition = {
  key: WizardStepKey;
  index: number;
  label: string;
  shortDesc: string;
};

export const WIZARD_STEPS: readonly WizardStepDefinition[] = [
  { key: "lead", index: 0, label: "ثبت سرنخ", shortDesc: "ثبت شخص، شماره تماس و شرح اولیه" },
  { key: "reception", index: 1, label: "پذیرش مدیر", shortDesc: "بررسی و پذیرش سرنخ در رنج" },
  { key: "assignment", index: 2, label: "ارجاع", shortDesc: "تعیین مشاور مسئول و مهلت الزامی" },
  { key: "acceptance", index: 3, label: "پذیرش مشاور", shortDesc: "قبول یا رد ارجاع توسط مشاور" },
  { key: "appraisal", index: 4, label: "کارشناسی ملک", shortDesc: "ثبت مشخصات ملک، مالکان و گزارش کارشناسی" },
  { key: "review", index: 5, label: "تأیید ملک", shortDesc: "تعیین عنوان مدیریتی و تصمیم نهایی مدیر" },
  { key: "listing", index: 6, label: "فایل عرضه", shortDesc: "تعریف شرایط معامله و انتشار فایل عرضه" },
];

export const STAGE_LABELS_FA: Record<SupplyStage, string> = {
  reception: "پذیرش مدیر",
  assignment: "ارجاع",
  acceptance: "پذیرش مشاور",
  appraisal: "کارشناسی ملک",
  review: "تأیید ملک",
  listing: "فایل عرضه",
  closed: "بسته‌شده",
};

/**
 * The lead-source choices the server accepts, mirroring `apps.crm.models.LeadSource`.
 *
 * The wizard submits one of these values as `lead_source` and the server rejects anything outside
 * the enum with 400 "منبع سرنخ معتبر نیست", so the list has to be generated from — not guessed
 * next to — the model. A backend test (`test_lead_source_options_match_the_model_choices`) fails
 * as soon as this list and the enum drift apart.
 */
export const LEAD_SOURCE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "OWNER_REFERRAL", label: "مراجعه یا تماس مالک" },
  { value: "ADVISOR_NETWORK", label: "شبکه ارتباطی مشاور" },
  { value: "PORTAL", label: "پرتال و آگهی" },
  { value: "REFERRAL", label: "معرفی" },
  { value: "WALK_IN", label: "حضوری" },
  { value: "OTHER", label: "سایر" },
];

/** Default of the server field, used whenever a stored value is no longer part of the enum. */
export const DEFAULT_LEAD_SOURCE = "OWNER_REFERRAL";

/** True when `value` is one of the codes the server accepts. */
export function isLeadSource(value: unknown): boolean {
  return LEAD_SOURCE_OPTIONS.some((option) => option.value === value);
}

/**
 * Keeps a previously stored draft usable: older drafts saved codes the server never accepted
 * (`DIRECT_CALL`, `WEBSITE`, …), so they are replaced by the default instead of failing the submit.
 */
export function normalizeLeadSource(value: unknown): string {
  const candidate = typeof value === "string" ? value.trim().toUpperCase() : "";
  return isLeadSource(candidate) ? candidate : DEFAULT_LEAD_SOURCE;
}

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function normalizePersianSearch(raw: string): string {
  let out = String(raw || "");
  for (let i = 0; i < 10; i += 1) {
    out = out.replaceAll(PERSIAN_DIGITS[i], String(i)).replaceAll(ARABIC_DIGITS[i], String(i));
  }
  return out
    .replaceAll("ي", "ی")
    .replaceAll("ك", "ک")
    .replaceAll("ة", "ه")
    .replaceAll("\u200c", " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function formatFaInt(value: string | number | null | undefined, unknownLabel = "نامشخص"): string {
  if (value === null || value === undefined || String(value).trim() === "") return unknownLabel;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return unknownLabel;
  return parsed.toLocaleString("fa-IR");
}

export function formatFaAmount(value: string | number | null | undefined, unit = "تومان"): string {
  if (value === null || value === undefined || String(value).trim() === "") return "نامشخص";
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "نامشخص";
  return `${parsed.toLocaleString("fa-IR")} ${unit}`.trim();
}

export function deriveWizardStage(record: PropertyCaseRecord | null | undefined): WizardStepKey {
  if (!record) return "lead";
  switch (record.stage) {
    case "reception":
      return "reception";
    case "assignment":
      return "assignment";
    case "acceptance":
      return "acceptance";
    case "appraisal":
      return "appraisal";
    case "review":
      return "review";
    case "listing":
      return "listing";
    case "closed":
      return record.resulting_property ? "review" : "reception";
    default:
      return "reception";
  }
}

export function wizardStepIndex(step: WizardStepKey): number {
  const found = WIZARD_STEPS.find((item) => item.key === step);
  return found ? found.index : 0;
}

export type RoleGuidance = {
  headline: string;
  body: string;
  canActNow: boolean;
  futureLockReason: string;
};

export function stageGuidanceForRole(
  record: PropertyCaseRecord | null | undefined,
  role: Role,
  currentUserId?: string | null,
): RoleGuidance {
  if (!record) {
    return {
      headline: "ثبت اطلاعات اولیه و مالک",
      body: "نام و شماره تماس شخص مرتبط، شرح اولیهٔ ملک و منبع سرنخ را ثبت کنید تا پروندهٔ تأمین ایجاد شود.",
      canActNow: role !== "finance",
      futureLockReason: "ابتدا باید پروندهٔ ثبت ملک ایجاد شود تا مراحل بعدی فعال شوند.",
    };
  }
  const isManager = role === "admin" || role === "range_manager";
  const isAssignee = Boolean(record.assigned_to && currentUserId && String(record.assigned_to) === String(currentUserId));

  if (record.stage === "closed") {
    return {
      headline: "این پرونده بسته یا متوقف شده است",
      body: record.closure_reason
        ? `دلیل ثبت‌شده: ${record.closure_reason}`
        : "برای ادامهٔ عملیات روی این پرونده، ابتدا مدیر رنج باید پرونده را بازگشایی کند.",
      canActNow: isManager,
      futureLockReason: "پرونده در وضعیت بسته قرار دارد و پیشروی در مراحل بعدی متوقف است.",
    };
  }
  if (record.stage === "reception") {
    return isManager
      ? {
          headline: "سرنخ منتظر پذیرش شماست",
          body: "اطلاعات تماس و شرح اولیه را بررسی کنید و سرنخ را بپذیرید تا وارد مرحلهٔ ارجاع شود.",
          canActNow: true,
          futureLockReason: "تا پیش از پذیرش سرنخ توسط مدیر رنج، ارجاع و کارشناسی فعال نمی‌شود.",
        }
      : {
          headline: "در انتظار پذیرش مدیر رنج",
          body: "سرنخ ثبت شده و برای مدیر رنج ارسال شده است. پس از پذیرش و ارجاع، ادامهٔ کار برای مشاور فعال می‌شود.",
          canActNow: false,
          futureLockReason: "این مرحله در اختیار مدیر رنج است و پس از پذیرش سرنخ باز می‌شود.",
        };
  }
  if (record.stage === "assignment") {
    return isManager
      ? {
          headline: "مشاور مسئول و مهلت کارشناسی را تعیین کنید",
          body: "یک مشاور فعال در رنج انتخاب کنید و مهلت انجام کارشناسی را ثبت کنید.",
          canActNow: true,
          futureLockReason: "پیش از تعیین مشاور مسئول و مهلت الزامی، مرحلهٔ پذیرش و کارشناسی آغاز نمی‌شود.",
        }
      : {
          headline: "در انتظار ارجاع توسط مدیر رنج",
          body: "سرنخ پذیرفته شده است و مدیر رنج باید مشاور مسئول و مهلت کارشناسی را مشخص کند.",
          canActNow: false,
          futureLockReason: "پس از ارجاع پرونده به مشاور مسئول، مرحلهٔ بعد فعال می‌شود.",
        };
  }
  if (record.stage === "acceptance") {
    return isAssignee || role === "admin"
      ? {
          headline: "ارجاع پرونده منتظر پاسخ شماست",
          body: "پرونده را بپذیرید تا کارشناسی ملک باز شود، یا با ثبت دلیل مشخص آن را به مدیر بازگردانید.",
          canActNow: true,
          futureLockReason: "تا پیش از پذیرش ارجاع توسط مشاور مسئول، فرم کارشناسی قفل است.",
        }
      : {
          headline: "منتظر پاسخ مشاور به ارجاع",
          body: isManager
            ? "مشاور فعلی باید ارجاع را بپذیرد یا رد کند. در صورت گذشت ۴۸ ساعت بدون پاسخ، امکان تغییر مشاور فعال می‌شود."
            : "این پرونده به مشاور دیگری ارجاع شده است.",
          canActNow: isManager,
          futureLockReason: "تا زمان پذیرش ارجاع توسط مشاور مسئول، مراحل کارشناسی و تأیید باز نمی‌شوند.",
        };
  }
  if (record.stage === "appraisal") {
    const needsFixes = record.property_review_status === "CHANGES_REQUIRED";
    return isAssignee || isManager
      ? {
          headline: needsFixes ? "اصلاحات مورد نظر مدیر را اعمال و دوباره ارسال کنید" : "مشخصات ملک، مالکان و گزارش کارشناسی را تکمیل کنید",
          body: "آدرس، منطقه، متراژ، نوع ملک، اشخاص مرتبط با ملک و متن کامل گزارش کارشناسی را ذخیره کنید و برای تأیید مدیر بفرستید.",
          canActNow: true,
          futureLockReason: "ارسال کارشناسی کامل به صف بررسی مدیر پیش‌نیاز ورود به مرحلهٔ تأیید ملک است.",
        }
      : {
          headline: "کارشناسی توسط مشاور مسئول در جریان است",
          body: "تکمیل مشخصات ملک و گزارش بازدید در اختیار مشاور مسئول پرونده است.",
          canActNow: false,
          futureLockReason: "پس از تکمیل و ارسال کارشناسی، مرحلهٔ تأیید ملک فعال می‌شود.",
        };
  }
  if (record.stage === "review") {
    return isManager
      ? {
          headline: "گزارش کارشناسی آمادهٔ بررسی و تأیید شماست",
          body: "عنوان مدیریتی ملک را مشخص کنید و پس از بررسی گزارش کارشناسی، ملک را تأیید کنید یا برای اصلاح برگردانید.",
          canActNow: true,
          futureLockReason: "تا پیش از تأیید نهایی ملک توسط مدیر، امکان تعریف و انتشار فایل عرضه وجود ندارد.",
        }
      : {
          headline: "گزارش کارشناسی برای تأیید مدیر ارسال شده است",
          body: "پس از ثبت عنوان مدیریتی و تأیید نهایی ملک توسط مدیر رنج، مرحلهٔ ساخت فایل عرضه فعال می‌شود.",
          canActNow: false,
          futureLockReason: "تعریف فایل عرضه فقط پس از تأیید نهایی ملک مجاز است.",
        };
  }
  return isAssignee || isManager
    ? {
        headline: "ملک تأیید شده است؛ فایل‌های عرضه را مدیریت کنید",
        body: "برای هر نوع معاملهٔ مجاز یک فایل عرضه تعریف کنید، شرایط اختصاصی آن را ثبت کنید و وضعیت پیش‌نویس، فعال یا متوقف را مدیریت کنید.",
        canActNow: true,
        futureLockReason: "",
      }
    : {
        headline: "ملک تأیید شده است",
        body: "مدیریت فایل‌های عرضه در اختیار مشاور مسئول یا مدیر رنج است.",
        canActNow: false,
        futureLockReason: "",
      };
}

export type StallInfo = {
  waitingDays: number;
  isStalled: boolean;
  isOverdue: boolean;
  canReassignUnanswered: boolean;
};

export function computeStallInfo(record: PropertyCaseRecord, nowMs = Date.now()): StallInfo {
  const anchorRaw =
    record.stage === "acceptance"
      ? record.assigned_at || record.updated_at || record.created_at
      : record.updated_at || record.assigned_at || record.created_at;
  const anchorMs = anchorRaw ? new Date(anchorRaw).getTime() : nowMs;
  const elapsedMs = Math.max(0, nowMs - (Number.isFinite(anchorMs) ? anchorMs : nowMs));
  const waitingDays = Math.floor(elapsedMs / 86_400_000);
  const dueMs = record.due_at ? new Date(record.due_at).getTime() : NaN;
  const isOverdue = record.stage !== "closed" && record.stage !== "listing" && Number.isFinite(dueMs) && nowMs > dueMs;
  const assignedMs = record.assigned_at ? new Date(record.assigned_at).getTime() : NaN;
  const canReassignUnanswered =
    record.acceptance_status === "PENDING" &&
    Number.isFinite(assignedMs) &&
    nowMs - assignedMs >= 48 * 3_600_000;
  const isStalled = record.stage !== "closed" && record.stage !== "listing" && (isOverdue || waitingDays >= 3);
  return { waitingDays, isStalled, isOverdue, canReassignUnanswered };
}

export type SupplyDraftEnvelope<T> = {
  schemaVersion: 1;
  savedAt: string;
  baseVersion: number | null;
  fields: T;
};

export function supplyDraftKey(userKey: string, caseId?: string | number | null): string {
  const cleanUser = encodeURIComponent(String(userKey || "guest").trim() || "guest");
  const cleanCase = caseId ? String(caseId).trim() : "new";
  return `zaminex:supply-draft:v1:${cleanUser}:${cleanCase}`;
}

export function readSupplyDraft<T>(userKey: string, caseId?: string | number | null): SupplyDraftEnvelope<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(supplyDraftKey(userKey, caseId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SupplyDraftEnvelope<T>>;
    if (parsed.schemaVersion !== 1 || !parsed.fields || typeof parsed.fields !== "object") return null;
    return {
      schemaVersion: 1,
      savedAt: String(parsed.savedAt || ""),
      baseVersion: typeof parsed.baseVersion === "number" ? parsed.baseVersion : null,
      fields: parsed.fields,
    };
  } catch {
    return null;
  }
}

export function writeSupplyDraft<T extends Record<string, unknown>>(
  userKey: string,
  caseId: string | number | null | undefined,
  fields: T,
  baseVersion: number | null,
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: SupplyDraftEnvelope<T> = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      baseVersion,
      fields,
    };
    window.localStorage.setItem(supplyDraftKey(userKey, caseId), JSON.stringify(payload));
  } catch {
    return;
  }
}

export function clearSupplyDraft(userKey: string, caseId?: string | number | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(supplyDraftKey(userKey, caseId));
  } catch {
    return;
  }
}

export type LastVisitedCase = {
  id: number;
  code: string;
  title: string;
  stageLabel: string;
  visitedAt: string;
};

function lastVisitedKey(userKey: string): string {
  return `zaminex:last-visited-case:v1:${encodeURIComponent(String(userKey || "guest").trim() || "guest")}`;
}

export function saveLastVisitedCase(userKey: string, entry: Omit<LastVisitedCase, "visitedAt">): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      lastVisitedKey(userKey),
      JSON.stringify({ ...entry, visitedAt: new Date().toISOString() }),
    );
  } catch {
    return;
  }
}

export function readLastVisitedCase(userKey: string): LastVisitedCase | null {
  if (typeof window === "undefined") return;
  try {
    const raw = window.sessionStorage.getItem(lastVisitedKey(userKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastVisitedCase>;
    if (!parsed.id || !parsed.code) return null;
    return {
      id: Number(parsed.id),
      code: String(parsed.code),
      title: String(parsed.title || parsed.code),
      stageLabel: String(parsed.stageLabel || ""),
      visitedAt: String(parsed.visitedAt || ""),
    };
  } catch {
    return null;
  }
}

export function clearLastVisitedCase(userKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(lastVisitedKey(userKey));
  } catch {
    return;
  }
}

export type DealTypeChangePreview = {
  preservedTerms: Record<string, string | number | boolean>;
  incompatibleFields: Array<{ key: string; label: string }>;
  addedRequiredFields: DealTermField[];
};

export function previewDealTypeChange(
  previousSchema: DealTermsSchema | null | undefined,
  nextSchema: DealTermsSchema | null | undefined,
  currentTerms: Record<string, string | number | boolean | null | undefined>,
): DealTypeChangePreview {
  const prevLabels = new Map<string, string>(
    (previousSchema?.fields || []).map((f) => [f.key, f.label]),
  );
  const nextFields = nextSchema?.fields || [];
  const nextKeys = new Set(nextFields.map((f) => f.key));
  const preservedTerms: Record<string, string | number | boolean> = {};
  const incompatibleFields: Array<{ key: string; label: string }> = [];

  for (const [key, val] of Object.entries(currentTerms || {})) {
    if (val === null || val === undefined || String(val).trim() === "") continue;
    if (nextKeys.has(key)) {
      preservedTerms[key] = val;
    } else {
      incompatibleFields.push({ key, label: prevLabels.get(key) || key });
    }
  }

  const addedRequiredFields = nextFields.filter(
    (field) => field.required && !(field.key in preservedTerms),
  );

  return { preservedTerms, incompatibleFields, addedRequiredFields };
}

export function supplyStatusBadgeMeta(
  domain: "property_review" | "listing" | "case",
  rawStatus: string | null | undefined,
): { label: string; variant: BadgeV } {
  const norm = String(rawStatus || "").trim().toUpperCase();
  if (domain === "property_review") {
    if (norm === "APPROVED") return { label: "تأییدشده", variant: "success" };
    if (norm === "PENDING") return { label: "در انتظار بررسی", variant: "warning" };
    if (norm === "CHANGES_REQUIRED") return { label: "نیازمند اصلاح", variant: "danger" };
    return { label: "تکمیل‌نشده", variant: "muted" };
  }
  if (domain === "listing") {
    if (norm === "ACTIVE") return { label: "فعال", variant: "info" };
    if (norm === "PAUSED") return { label: "متوقف", variant: "warning" };
    if (norm === "DRAFT") return { label: "پیش‌نویس", variant: "muted" };
    if (norm === "SOLD") return { label: "واگذارشده", variant: "purple" };
    return { label: "بایگانی", variant: "muted" };
  }
  if (norm === "COMPLETED") return { label: "کارشناسی تکمیل‌شده", variant: "success" };
  if (norm === "CLOSED") return { label: "بسته", variant: "muted" };
  if (norm === "CANCELLED") return { label: "لغوشده", variant: "danger" };
  if (norm === "DUPLICATE") return { label: "تکراری", variant: "warning" };
  return { label: "جریان فعال", variant: "info" };
}

const SUPPLY_REFRESH_EVENT = "zaminex:supply-counters-refresh";

export function emitSupplyCountersRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SUPPLY_REFRESH_EVENT));
}

export function subscribeSupplyCountersRefresh(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(SUPPLY_REFRESH_EVENT, listener);
  return () => window.removeEventListener(SUPPLY_REFRESH_EVENT, listener);
}
