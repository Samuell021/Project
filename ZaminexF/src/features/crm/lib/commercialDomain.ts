import { daysInJalaliMonth, firstWeekdayOfJalaliMonth } from "../../../shared/lib/jdate";
import type { Role } from "../../../shared/lib/types";

export type InquiryStage =
  | "reception"
  | "assignment"
  | "acceptance"
  | "needs"
  | "matching"
  | "viewings"
  | "negotiation"
  | "contract"
  | "closed";

export type InquiryStepKey = "lead" | Exclude<InquiryStage, "closed">;

export type InquiryPreference = {
  id?: number;
  deal_type: number;
  deal_type_version?: number | null;
  min_amount?: string | number | null;
  max_amount?: string | number | null;
  max_deposit?: string | number | null;
  max_monthly_rent?: string | number | null;
  min_area?: string | number | null;
  max_area?: string | number | null;
  criteria?: Record<string, unknown>;
  districts?: number[];
  property_types?: number[];
};

export type InquiryRecord = {
  id: number;
  code: string;
  contact: number;
  contact_name: string;
  contact_phone?: string;
  sales_range?: number | null;
  sales_range_name?: string | null;
  description?: string;
  lead_status?: string;
  acceptance_status?: string;
  status: string;
  stage: InquiryStage;
  stage_label?: string;
  stage_responsible?: string;
  assigned_to?: number | null;
  assigned_to_name?: string | null;
  due_at?: string | null;
  needs_confirmed_at?: string | null;
  version: number;
  preferences?: InquiryPreference[];
  created_at?: string;
  updated_at?: string;
};

export type MatchReason = { label: string; passed: boolean; detail?: string };

export type MatchResult = {
  property_file_id: number;
  listing_id?: number;
  title: string;
  property_title?: string;
  district?: string;
  area?: string | number | null;
  deal_type?: number;
  deal_type_name?: string;
  sale_price?: string | number | null;
  deposit?: string | number | null;
  monthly_rent?: string | number | null;
  matched: boolean;
  match_percent: number;
  reasons: MatchReason[];
  blockers: string[];
  already_introduced: boolean;
  buyer_consultant_name?: string;
  seller_consultant_name?: string;
  snapshot?: Record<string, unknown>;
};

export type DealStage = "NEGOTIATION" | "OFFERED" | "AGREED" | "CONTRACT" | "LOST" | "CANCELLED" | "COMPLETED" | "FINALIZED";

export type ViewingRecord = {
  id: number;
  introduction: number;
  scheduled_at: string;
  result: string;
  notes?: string;
  task?: number | null;
  completed_at?: string | null;
  inquiry_id?: number;
  inquiry_code?: string;
  contact_name?: string;
  property_file_title?: string;
  assigned_to_name?: string;
  version?: number;
};

export type ContractTermField = {
  key: string;
  label: string;
  type: "integer" | "decimal" | "text" | "boolean" | "date";
  unit?: string;
  required: boolean;
};

export type ContractTermsSchema = { fields: ContractTermField[] };

export type ContractRecord = {
  id: number;
  deal: number;
  contract_number: string;
  status: string;
  deal_type?: number | null;
  deal_type_name?: string;
  deal_type_version?: number;
  terms_snapshot?: Record<string, unknown>;
  terms_history?: Array<Record<string, unknown>>;
  sale_price?: string | number | null;
  deposit?: string | number | null;
  monthly_rent?: string | number | null;
  signed_at?: string | null;
  effective_at?: string | null;
  finalized_at?: string | null;
  version: number;
  parties?: Array<{ id: number; contact: number; contact_name: string; party_role: string; signature_status: string; identity_snapshot?: Record<string, unknown> }>;
  attachments?: Array<Record<string, unknown>>;
  amendments?: Array<Record<string, unknown>>;
};

export type StepDefinition = {
  key: InquiryStepKey;
  label: string;
  owner: string;
  description: string;
};

export const INQUIRY_STEPS: readonly StepDefinition[] = [
  { key: "lead", label: "ثبت درخواست", owner: "ثبت‌کننده", description: "ثبت شخص متقاضی، رنج و شرح اولیهٔ درخواست" },
  { key: "reception", label: "پذیرش مدیر", owner: "مدیر رنج", description: "بررسی درخواست و پذیرش آن در رنج مسئول" },
  { key: "assignment", label: "ارجاع", owner: "مدیر رنج", description: "تعیین مشاور مسئول و مهلت پیگیری" },
  { key: "acceptance", label: "پذیرش مشاور", owner: "مشاور مسئول", description: "قبول یا رد ارجاع توسط مشاور" },
  { key: "needs", label: "تکمیل نیاز", owner: "مشاور مسئول", description: "ثبت نیاز و بودجه برای هر نوع معامله" },
  { key: "matching", label: "معرفی فایل", owner: "مشاور مسئول", description: "بررسی تطبیق و معرفی صریح فایل" },
  { key: "viewings", label: "بازدید", owner: "مشاور مسئول", description: "زمان‌بندی بازدید و ثبت نتیجه" },
  { key: "negotiation", label: "مذاکره", owner: "مشاور مسئول", description: "ثبت نتیجهٔ توافق یا عدم توافق" },
  { key: "contract", label: "قرارداد", owner: "مدیر کل", description: "تنظیم، امضا و قطعی‌سازی قرارداد" },
];

export const INQUIRY_STAGE_LABELS: Record<InquiryStage, string> = {
  reception: "پذیرش مدیر",
  assignment: "ارجاع",
  acceptance: "پذیرش مشاور",
  needs: "تکمیل نیاز",
  matching: "معرفی فایل",
  viewings: "بازدید",
  negotiation: "مذاکره",
  contract: "قرارداد",
  closed: "بسته‌شده",
};

export const DEAL_STAGE_LABELS: Record<string, string> = {
  NEGOTIATION: "مذاکره",
  OFFERED: "پیشنهاد",
  AGREED: "توافق",
  CONTRACT: "قرارداد",
  FINALIZED: "قطعی‌شده",
  COMPLETED: "تکمیل‌شده",
  LOST: "عدم توافق",
  CANCELLED: "لغو‌شده",
};

export const CLOSED_STATUSES = ["CLOSED", "CANCELLED", "DUPLICATE", "LOST"];

export function deriveInquiryStep(record: InquiryRecord | null | undefined): InquiryStepKey {
  if (!record) return "lead";
  if (record.stage && record.stage !== "closed") return record.stage as InquiryStepKey;
  if (record.stage === "closed") return "contract";
  if (CLOSED_STATUSES.includes(String(record.status))) return "contract";
  if (record.status === "COMPLETED") return "contract";
  const leadStatus = record.lead_status || "NEW";
  if (leadStatus === "NEW" || leadStatus === "PENDING") return "reception";
  if (!record.assigned_to) return "assignment";
  if (record.acceptance_status === "REJECTED") return "assignment";
  if (record.acceptance_status === "PENDING") return "acceptance";
  if (!record.needs_confirmed_at) return "needs";
  return "matching";
}

export function stepIndex(step: InquiryStepKey): number {
  const index = INQUIRY_STEPS.findIndex((item) => item.key === step);
  return index < 0 ? 0 : index;
}

export function completedStepCount(step: InquiryStepKey): number {
  return stepIndex(step);
}

export function formatFaNumber(value: string | number | null | undefined, emptyLabel = "نامشخص"): string {
  if (value === null || value === undefined || String(value).trim() === "") return emptyLabel;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return emptyLabel;
  return parsed.toLocaleString("fa-IR");
}

export function formatFaMoney(value: string | number | null | undefined): string {
  const formatted = formatFaNumber(value);
  return formatted === "نامشخص" ? formatted : `${formatted} تومان`;
}

export function sortMatches(matches: MatchResult[]): MatchResult[] {
  return [...matches].sort((left, right) => {
    if (left.matched !== right.matched) return left.matched ? -1 : 1;
    if (right.match_percent !== left.match_percent) return right.match_percent - left.match_percent;
    return left.property_file_id - right.property_file_id;
  });
}

export function matchSummary(match: MatchResult): string {
  if (match.matched) return "همهٔ شرط‌های الزامی و بودجه منطبق است";
  if (match.blockers.length) return match.blockers.join("، ");
  const failed = match.reasons.filter((reason) => !reason.passed).map((reason) => reason.label);
  return failed.length ? `ناسازگاری در ${failed.join("، ")}` : "شرط‌های کافی برای تطبیق ثبت نشده است";
}

export function budgetLabel(preference: InquiryPreference | null | undefined, family?: string | null): string {
  if (!preference) return "بودجه ثبت نشده است";
  if (family === "RENT" || family === "FULL_MORTGAGE") {
    return `ودیعه تا ${formatFaMoney(preference.max_deposit)} · اجاره تا ${formatFaMoney(preference.max_monthly_rent)}`;
  }
  return `از ${formatFaMoney(preference.min_amount)} تا ${formatFaMoney(preference.max_amount)}`;
}

export function stepGuidance(record: InquiryRecord | null | undefined, role: Role, currentUserId?: string | null): { headline: string; body: string; canAct: boolean } {
  const step = deriveInquiryStep(record);
  if (!record) {
    return { headline: "درخواست تازهٔ متقاضی", body: "متقاضی، رنج و شرح اولیه را ثبت کنید؛ پذیرش و ارجاع روی همین پرونده ادامه می‌یابد.", canAct: true };
  }
  const isLeadManager = role === "admin" || role === "range_manager";
  if (step === "reception") {
    return isLeadManager
      ? { headline: "درخواست در انتظار پذیرش مدیر رنج است", body: "پس از بررسی، درخواست را بپذیرید تا ارجاع به مشاور ممکن شود.", canAct: true }
      : { headline: "درخواست برای پذیرش به مدیر رنج سپرده شده است", body: "تا پذیرش مدیر، اقدام بعدی روی این پرونده انجام نمی‌شود.", canAct: false };
  }
  if (step === "assignment") {
    return isLeadManager
      ? { headline: "ارجاع به مشاور مسئول انجام نشده است", body: "مشاور مسئول و مهلت پیگیری را تعیین کنید.", canAct: true }
      : { headline: "در انتظار ارجاع توسط مدیر رنج", body: "پس از ارجاع، پذیرش یا رد آن در اختیار مشاور است.", canAct: false };
  }
  if (step === "acceptance") {
    const isAssignee = currentUserId && String(record.assigned_to) === String(currentUserId);
    return isAssignee
      ? { headline: "ارجاع را بپذیرید یا با دلیل رد کنید", body: "پس از پذیرش، ثبت نیاز و بودجه فعال می‌شود.", canAct: true }
      : { headline: "در انتظار پذیرش مشاور مسئول", body: "تا پذیرش، تکمیل نیاز و تطبیق انجام نمی‌شود.", canAct: false };
  }
  if (step === "needs") {
    return { headline: "نیاز و بودجه را برای هر نوع معامله ثبت کنید", body: "برای هر نوع معامله، بازهٔ مبلغ، ودیعه و اجاره، مناطق و انواع ملک جداگانه ثبت می‌شود.", canAct: role !== "admin" || true };
  }
  if (step === "matching") {
    return { headline: "فایل‌های منطبق را بررسی و صریحاً معرفی کنید", body: "تطبیق فقط پیشنهاد است؛ معرفی با ثبت صریح و درج وضعیت شرایط فایل انجام می‌شود.", canAct: true };
  }
  if (step === "viewings") {
    return { headline: "بازدید را زمان‌بندی و نتیجهٔ آن را ثبت کنید", body: "ثبت بازدید یک وظیفهٔ هم‌زمان می‌سازد و ثبت نتیجه آن وظیفه را می‌بندد.", canAct: true };
  }
  if (step === "negotiation") {
    return { headline: "نتیجهٔ مذاکره را ثبت کنید", body: "توافق موفق مذاکره را برای قرارداد آماده می‌کند و عدم توافق دلیل الزامی دارد.", canAct: true };
  }
  if (record.status === "COMPLETED") {
    return { headline: "قرارداد قطعی شده و پرونده تکمیل است", body: "تغییر مرحله پس از قطعی‌سازی قرارداد ممکن نیست.", canAct: false };
  }
  return { headline: "قرارداد در جریان است", body: "تنظیم شرایط، ثبت امضا و قطعی‌سازی توسط مدیر کل انجام می‌شود.", canAct: role === "admin" };
}

export type TermsValidation = {
  errors: Record<string, string>;
  missing: string[];
  values: Record<string, unknown>;
  valid: boolean;
};

export function validateContractTerms(schema: ContractTermsSchema | null | undefined, terms: Record<string, unknown> | null | undefined): TermsValidation {
  const fields = schema?.fields || [];
  const values = terms || {};
  const errors: Record<string, string> = {};
  const missing: string[] = [];
  if (!fields.length) {
    return { errors: { terms: "تعریف شرایط برای این نوع معامله ثبت نشده است." }, missing, values, valid: false };
  }
  const allowed = new Set(fields.map((field) => field.key));
  Object.keys(values).forEach((key) => {
    if (!allowed.has(key)) errors[key] = "این فیلد در تعریف شرایط معامله وجود ندارد.";
  });
  fields.forEach((field) => {
    const value = values[field.key];
    if (value === null || value === undefined || String(value).trim() === "") {
      if (field.required) {
        errors[field.key] = `وارد کردن ${field.label} الزامی است.`;
        missing.push(field.label);
      }
      return;
    }
    if (field.type === "integer" || field.type === "decimal") {
      if (typeof value === "boolean") {
        errors[field.key] = "مقدار عددی در بازه مجاز وارد کنید.";
        return;
      }
      const numeric = Number(String(value).replace(/[٠-٩۰-۹]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹".indexOf(digit) % 10)));
      const withinRange = Number.isFinite(numeric) && numeric >= 0 && numeric < 1e18 && (field.unit !== "درصد" || numeric <= 100);
      const integral = field.type !== "integer" || Number.isInteger(numeric);
      if (!withinRange || !integral) errors[field.key] = "مقدار عددی در بازه مجاز وارد کنید.";
    } else if (field.type === "boolean" && typeof value !== "boolean") {
      errors[field.key] = "مقدار بله یا خیر معتبر نیست.";
    } else if (field.type === "text" && typeof value !== "string") {
      errors[field.key] = "مقدار متنی معتبر نیست.";
    } else if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      errors[field.key] = "تاریخ معتبر نیست.";
    }
  });
  return { errors, missing, values, valid: Object.keys(errors).length === 0 };
}

export function contractMissingItems(contract: ContractRecord | null | undefined, schema?: ContractTermsSchema | null): string[] {
  if (!contract) return ["قرارداد انتخاب نشده است."];
  const items: string[] = [];
  const validation = validateContractTerms(schema || null, contract.terms_snapshot || {});
  items.push(...validation.missing);
  if (!contract.parties || !contract.parties.length) items.push("طرفین قرارداد ثبت نشده‌اند.");
  const unsigned = (contract.parties || []).filter((party) => party.signature_status !== "SIGNED");
  if (unsigned.length) items.push(`امضای ${unsigned.map((party) => party.contact_name).join("، ")} ثبت نشده است.`);
  return items;
}

export function contractFinancialSummary(contract: ContractRecord | null | undefined): { label: string; value: string }[] {
  if (!contract) return [];
  const terms = contract.terms_snapshot || {};
  const rows: Array<{ label: string; value: string }> = [];
  const labels: Record<string, string> = {
    sale_price: "ثمن معامله",
    deposit: "ودیعه",
    monthly_rent: "اجاره ماهانه",
    down_payment: "پیش‌پرداخت",
    installments: "شرح اقساط",
    owner_share: "سهم مالک",
    contribution: "آورده",
    exchange_asset: "عوض معامله",
    cash_difference: "مابه‌التفاوت",
  };
  Object.entries(terms).forEach(([key, value]) => {
    if (value === null || value === undefined || String(value).trim() === "") return;
    const label = labels[key] || key;
    const numeric = ["sale_price", "deposit", "monthly_rent", "down_payment", "cash_difference"].includes(key);
    rows.push({ label, value: numeric ? formatFaMoney(value as string | number) : String(value) });
  });
  if (!rows.length) rows.push({ label: "شرایط مالی", value: "ثبت نشده است" });
  return rows;
}

export type CalendarCell = { key: string; day: number | null; isoDate: string | null };

export function buildViewingCalendar(jy: number, jm: number): CalendarCell[] {
  const total = daysInJalaliMonth(jy, jm);
  const offset = firstWeekdayOfJalaliMonth(jy, jm);
  const cells: CalendarCell[] = [];
  for (let blank = 0; blank < offset; blank += 1) cells.push({ key: `blank-${blank}`, day: null, isoDate: null });
  for (let day = 1; day <= total; day += 1) {
    cells.push({ key: `${jy}-${jm}-${day}`, day, isoDate: `${jy}-${String(jm).padStart(2, "0")}-${String(day).padStart(2, "0")}` });
  }
  return cells;
}

export type InquiryDraftEnvelope = { schemaVersion: 1; savedAt: string; baseVersion: number | null; fields: Record<string, unknown> };

export function inquiryDraftKey(userKey: string, inquiryId?: string | number | null): string {
  const user = encodeURIComponent(String(userKey || "guest").trim() || "guest");
  return `zaminex:inquiry-draft:v1:${user}:${inquiryId ? String(inquiryId) : "new"}`;
}

export function readInquiryDraft(userKey: string, inquiryId?: string | number | null): InquiryDraftEnvelope | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(inquiryDraftKey(userKey, inquiryId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<InquiryDraftEnvelope>;
    if (parsed.schemaVersion !== 1 || !parsed.fields || typeof parsed.fields !== "object") return null;
    return { schemaVersion: 1, savedAt: String(parsed.savedAt || ""), baseVersion: typeof parsed.baseVersion === "number" ? parsed.baseVersion : null, fields: parsed.fields };
  } catch {
    return null;
  }
}

export function writeInquiryDraft(userKey: string, inquiryId: string | number | null | undefined, fields: Record<string, unknown>, baseVersion: number | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      inquiryDraftKey(userKey, inquiryId),
      JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), baseVersion, fields }),
    );
  } catch {
    return;
  }
}

export function clearInquiryDraft(userKey: string, inquiryId?: string | number | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(inquiryDraftKey(userKey, inquiryId));
  } catch {
    return;
  }
}

export type LastInquiryCase = { id: number; code: string; contactName: string; stageLabel: string; visitedAt: string };

const LAST_INQUIRY_TTL_MS = 7 * 24 * 3_600_000;

function lastInquiryKey(userKey: string): string {
  return `zaminex:inquiry-last:v1:${encodeURIComponent(String(userKey || "guest").trim() || "guest")}`;
}

export function saveLastInquiryCase(userKey: string, entry: Omit<LastInquiryCase, "visitedAt">, nowMs = Date.now()): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(lastInquiryKey(userKey), JSON.stringify({ ...entry, visitedAt: new Date(nowMs).toISOString() }));
  } catch {
    return;
  }
}

export function readLastInquiryCase(userKey: string, nowMs = Date.now()): LastInquiryCase | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(lastInquiryKey(userKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastInquiryCase>;
    if (!parsed.id || !parsed.code) return null;
    const visitedMs = Date.parse(String(parsed.visitedAt || ""));
    if (!Number.isFinite(visitedMs) || nowMs - visitedMs > LAST_INQUIRY_TTL_MS) return null;
    return {
      id: Number(parsed.id),
      code: String(parsed.code),
      contactName: String(parsed.contactName || ""),
      stageLabel: String(parsed.stageLabel || ""),
      visitedAt: String(parsed.visitedAt || ""),
    };
  } catch {
    return null;
  }
}

export function clearLastInquiryCase(userKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(lastInquiryKey(userKey));
  } catch {
    return;
  }
}
