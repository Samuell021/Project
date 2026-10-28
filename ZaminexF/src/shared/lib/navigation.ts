import { Activity, BellRing, Building2, CheckSquare, LayoutDashboard, Settings, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Page, Role } from "./types";
import { pageIsAllowed } from "./permissions";

export type NavigationGroupId = "workspace" | "cases" | "operations" | "finance" | "people" | "settings";
export type NavigationEntry = {
  page: Page;
  label: string;
  keywords?: string;
  roles?: readonly Role[];
  /** Listed for every role except these (the destination stays reachable elsewhere, e.g. the settings tabs). */
  hiddenForRoles?: readonly Role[];
  /**
   * A creation shortcut rather than a destination of its own. The sidebar lists it exactly like
   * its siblings (one aligned column) and keeps it next to the records it creates.
   */
  auxiliary?: boolean;
  /** Draws the group's thin divider above this entry, separating it from unrelated entries. */
  separatorBefore?: boolean;
};
export type NavigationGroup = {
  id: NavigationGroupId;
  heading: string;
  /** The group holds a different set of destinations per role, so its sidebar title follows suit. */
  headingFor?: Partial<Record<Role, string>>;
  icon: LucideIcon;
  /** The whole group is not listed for these roles. */
  hiddenForRoles?: readonly Role[];
  items: readonly NavigationEntry[];
};
export type ResolvedNavigationGroup = Omit<NavigationGroup, "items"> & { items: NavigationEntry[] };
export type SettingsEntry = {
  page: Page;
  label: string;
  keywords?: string;
};

export const NAVIGATION_GROUPS: readonly NavigationGroup[] = [
  {
    id: "workspace", heading: "فضای کار", icon: LayoutDashboard, items: [
      { page: "admin-dashboard", label: "نمای کلی", roles: ["admin", "range_manager", "finance"], keywords: "داشبورد خلاصه شاخص" },
      { page: "consultant-dashboard", label: "نمای کلی", roles: ["consultant"], keywords: "داشبورد عملکرد" },
      { page: "my-tasks", label: "کارهای من", keywords: "وظیفه موعد پیگیری" },
      // Daily work above the divider, the shared intake and the history below it.
      { page: "crm-inbox", label: "کارتابل پذیرش", separatorBefore: true, keywords: "ارجاع پذیرش تمدید انصراف" },
      { page: "activity", label: "اعلان‌ها و سوابق", keywords: "اعلان سوابق تاریخچه" },
    ],
  },
  {
    id: "cases", heading: "پرونده‌ها", icon: Building2, items: [
      // People, then the property registration flow, then the applicant flow, then the supply side.
      { page: "crm-contacts", label: "اشخاص", keywords: "مالک متقاضی تماس" },
      { page: "add-property", label: "ثبت پرونده", separatorBefore: true, keywords: "ثبت ملک سرنخ پرونده کارشناسی" },
      { page: "crm-property-cases", label: "پرونده‌های ثبت ملک", keywords: "کارشناسی بررسی" },
      { page: "crm-reviews", label: "صف بررسی", roles: ["admin", "range_manager"], keywords: "تأیید برگشت کارشناسی" },
      { page: "crm-inquiry-register", label: "ثبت درخواست متقاضی", separatorBefore: true, keywords: "نیاز بودجه" },
      { page: "crm-inquiries", label: "درخواست متقاضیان", keywords: "نیاز تطبیق معرفی" },
      { page: "properties", label: "املاک", separatorBefore: true, keywords: "دارایی نقشه" },
      { page: "property-files", label: "فایل‌های عرضه", keywords: "قیمت شرایط فعال" },
      { page: "property-files-explore", label: "اکسپلور فایل‌های عرضه", keywords: "جست‌وجو معرفی" },
      { page: "create-property-file", label: "ساخت فایل", auxiliary: true },
    ],
  },
  {
    id: "operations", heading: "پیگیری عملیات", icon: CheckSquare, items: [
      // The admin sees every board; a consultant sees the same board narrowed to their own
      // records. Range managers and finance must not list it (address-level access is refused
      // by `pageIsAllowed`).
      { page: "crm-pipelines", label: "کاریز عملیات", roles: ["admin", "consultant"], keywords: "مرحله کاریز ستون" },
      // The follow-up flow (introduction → viewing → follow-up) with its creation shortcut.
      { page: "crm-introductions", label: "معرفی‌ها", separatorBefore: true, keywords: "معرفی فایل شرایط بازخورد" },
      { page: "crm-viewings", label: "بازدیدها و تقویم", keywords: "بازدید تقویم نتیجه" },
      { page: "follow-ups", label: "پیگیری‌ها", keywords: "تماس نتیجه اقدام بعدی" },
      { page: "create-followup", label: "ایجاد پیگیری", auxiliary: true },
      // Support tickets with their creation shortcut.
      { page: "tickets-received", label: "تیکت‌ها", separatorBefore: true, keywords: "پشتیبانی پیام" },
      { page: "create-ticket", label: "ثبت تیکت", auxiliary: true },
      // The task board, its calendar view and the create form.
      { page: "tasks-kanban", label: "تخته کارها", separatorBefore: true, auxiliary: true },
      { page: "tasks-calendar", label: "تقویم کارها", auxiliary: true },
      { page: "create-task", label: "افزودن کار", auxiliary: true },
    ],
  },
  {
    id: "finance", heading: "قرارداد و مالی", icon: Activity, items: [
      // The deal flow, then the money and reporting side of it.
      { page: "crm-deals", label: "مذاکرات", keywords: "مذاکره توافق" },
      { page: "crm-contracts", label: "قراردادها", keywords: "امضا اصلاحیه قطعی" },
      { page: "crm-finance", label: "کمیسیون و وجوه", separatorBefore: true, keywords: "مالی وصول سهم پرداخت" },
      { page: "crm-reports", label: "گزارش‌ها", keywords: "گزارش عملکرد تبدیل مالی" },
    ],
  },
  {
    id: "people", heading: "مدیریت کاربران و دسترسی", icon: Users, items: [
      { page: "consultants", label: "کارکنان", roles: ["admin", "range_manager"], keywords: "کارشناس مشاور پروفایل" },
      { page: "add-consultant", label: "افزودن کارمند", roles: ["admin", "range_manager"], auxiliary: true },
      // Range membership is a range-manager surface here: the admin edits the same records
      // as a tab of the settings page, so the admin sidebar keeps only the staff entries.
      { page: "settings-ranges", label: "رنج‌ها و تیم‌ها", roles: ["range_manager"], separatorBefore: true, keywords: "محدوده عضویت تیم" },
    ],
  },
  {
    id: "settings",
    heading: "تنظیمات و راهنما",
    // The admin manages workspace, login, deal-type and workflow settings as tabs of the
    // settings page, so this group carries only base data there and is titled accordingly.
    headingFor: { admin: "اطلاعات پایه" },
    // The consultant panel has no settings surface of its own.
    hiddenForRoles: ["consultant"],
    icon: Settings,
    items: [
      { page: "settings-workspace", label: "تنظیمات فضای کاری", hiddenForRoles: ["admin"], keywords: "شرکت رنگ تم" },
      { page: "guide", label: "راهنمای ساختار", hiddenForRoles: ["admin"], keywords: "روابط موجودیت جریان راهنما" },
      // Base data, then deal types, then login options.
      { page: "manage-districts", label: "مدیریت مناطق", separatorBefore: true, keywords: "اطلاعات پایه مناطق ویژگی نوع ملک" },
      { page: "manage-attributes", label: "ویژگی‌ها", auxiliary: true },
      // Application configuration (deal types and login options) below the base data.
      { page: "crm-deal-types", label: "انواع معامله", hiddenForRoles: ["admin"], separatorBefore: true, keywords: "شرایط نسخه انتشار" },
      { page: "settings-login-options", label: "گزینه‌های ورود", hiddenForRoles: ["admin"], auxiliary: true },
    ],
  },
];

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  { page: "settings-workspace", label: "فضای کاری", keywords: "اطلاعات شرکت رنگ سازمانی تم" },
  { page: "settings-permissions", label: "دسترسی‌ها", keywords: "نقش مجوز دسترسی" },
  { page: "settings-ranges", label: "رنج‌ها", keywords: "محدوده عضویت" },
  { page: "crm-settings", label: "تنظیمات گردش کار", keywords: "مهلت ارجاع کمیسیون" },
  { page: "crm-deal-types", label: "انواع معامله", keywords: "شرایط نسخه انتشار" },
  { page: "settings-login-options", label: "گزینه‌های ورود", keywords: "رمز پیامک ورود" },
  { page: "guide", label: "راهنمای ساختار", keywords: "روابط موجودیت مسیر راهنما" },
];

export const PROFILE_ENTRIES: readonly SettingsEntry[] = [
  { page: "my-profile", label: "پروفایل من", keywords: "نمای کلی" },
  { page: "my-profile-edit", label: "ویرایش پروفایل", keywords: "نام تصویر" },
  { page: "my-profile-security", label: "امنیت حساب", keywords: "رمز عبور" },
];

const SETTINGS_PAGES: ReadonlySet<Page> = new Set([
  "settings-workspace",
  "settings-permissions",
  "settings-ranges",
  "settings-login-options",
  "crm-settings",
  "crm-deal-types",
  "manage-districts",
  "manage-attributes",
  "guide",
]);

const FINANCE_PAGES: ReadonlySet<Page> = new Set([
  "my-tasks",
  "activity",
  "crm-contracts",
  "crm-finance",
  "crm-reports",
]);

function resolveEntry(item: NavigationEntry, role: Role): NavigationEntry {
  if (role !== "consultant") return item;
  if (item.page === "properties") return { ...item, page: "my-properties", label: "املاک من" };
  if (item.page === "property-files") return { ...item, page: "my-property-files", label: "فایل‌های عرضه من" };
  if (item.page === "follow-ups") return { ...item, page: "my-followups", label: "پیگیری‌های من" };
  return item;
}

export function getNavigationGroups(role: Role = "consultant", permissions?: string[] | null): ResolvedNavigationGroup[] {
  return NAVIGATION_GROUPS
    .filter((group) => !group.hiddenForRoles?.includes(role))
    .map((group) => ({
      ...group,
      heading: group.headingFor?.[role] ?? group.heading,
      items: group.items
        .filter((item) => !item.hiddenForRoles?.includes(role))
        .filter((item) => !item.roles || item.roles.includes(role))
        .map((item) => resolveEntry(item, role))
        .filter((item) => role !== "finance" || FINANCE_PAGES.has(item.page))
        .filter((item) => pageIsAllowed(item.page, role, permissions)),
    }))
    .filter((group) => group.items.length > 0);
}

export function getSettingsEntries(role: Role = "consultant", permissions?: string[] | null): SettingsEntry[] {
  return SETTINGS_ENTRIES.filter((entry) => pageIsAllowed(entry.page, role, permissions));
}

export function isSettingsPage(page: Page): boolean {
  return SETTINGS_PAGES.has(page);
}

export function navigationStorageKey(userId: string): string {
  return `zaminex:navigation:${encodeURIComponent(userId)}`;
}

export function readExpandedGroups(storage: Pick<Storage, "getItem">, key: string): NavigationGroupId[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) || "[]");
    if (!Array.isArray(value)) return [];
    return NAVIGATION_GROUPS.filter((group) => value.includes(group.id)).map((group) => group.id);
  } catch {
    return [];
  }
}
