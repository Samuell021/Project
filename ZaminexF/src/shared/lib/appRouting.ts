import type { Page } from "./types";

export type AppRoute = {
  page: Page;
  propertyId?: string;
  propertyReportId?: string;
  preselectedPropertyId?: string;
  propertyFileId?: string;
  consultantId?: string;
  followupId?: string;
  ticketId?: string;
  crmRecordId?: string;
};

const PAGE_TITLES: Record<Page, string> = {
  login: "ورود",
  forgot: "بازیابی رمز عبور",
  "admin-dashboard": "داشبورد مدیریت",
  properties: "همه املاک",
  "property-detail": "جزئیات ملک",
  "add-property": "ثبت پرونده",
  "edit-property": "ویرایش ملک",
  "property-files": "فایل‌ها",
  "property-files-explore": "اکسپلور فایل‌های عرضه",
  "create-property-file": "ثبت فایل",
  "property-file-detail": "جزئیات فایل",
  "edit-property-file": "ویرایش فایل",
  "tasks-kanban": "تخته وظایف",
  "tasks-calendar": "تقویم وظایف",
  "create-task": "افزودن وظیفه",
  consultants: "کارشناسان",
  "add-consultant": "افزودن کارشناس",
  "edit-consultant": "ویرایش کارشناس",
  "follow-ups": "پیگیری‌ها",
  "create-followup": "ایجاد پیگیری",
  "edit-followup": "ویرایش پیگیری",
  "tickets-sent": "تیکت‌های ارسالی",
  "tickets-received": "تیکت‌های دریافتی",
  "tickets-all": "همه تیکت‌ها",
  "create-ticket": "ثبت تیکت",
  "property-reports": "گزارش ملک",
  activity: "اعلان‌ها و سوابق",
  "settings-workspace": "تنظیمات فضای کاری",
  "settings-permissions": "دسترسی‌ها",
  "settings-ranges": "رنج‌ها",
  "settings-login-options": "گزینه‌های ورود",
  "manage-districts": "مدیریت مناطق",
  districts: "مناطق",
  "manage-attributes": "مدیریت ویژگی‌ها",
  "consultant-dashboard": "داشبورد کارشناس",
  "my-properties": "املاک من",
  "all-properties": "املاک من",
  "my-property-files": "فایل‌های من",
  "my-tasks": "وظایف من",
  "my-followups": "پیگیری‌های من",
  "my-profile": "پروفایل من",
  "crm-dashboard": "داشبورد",
  "crm-inbox": "کارتابل پذیرش",
  "crm-property-register": "ثبت پرونده",
  "crm-property-cases": "پرونده‌های ثبت ملک",
  "crm-reviews": "تأیید ملک",
  "crm-inquiries": "درخواست‌های متقاضی",
  "crm-inquiry-register": "ثبت درخواست متقاضی",
  "crm-introductions": "معرفی‌ها",
  "crm-viewings": "بازدیدها و تقویم",
  "crm-contacts": "اشخاص",
  "crm-pipelines": "کاریز عملیات",
  "crm-explore": "اکسپلور فایل‌های عرضه",
  "crm-deals": "معرفی، بازدید و مذاکره",
  "crm-contracts": "قراردادها",
  "crm-finance": "کمیسیون و وجوه",
  "crm-deal-types": "انواع معامله",
  "crm-reports": "گزارش‌های عملیات",
  "crm-settings": "تنظیمات CRM",
  guide: "راهنمای ساختار",

  "my-profile-edit": "ویرایش پروفایل",
  "my-profile-security": "امنیت حساب",
};

const validId = (value: string | number | undefined): string | undefined => {
  if (value == null) return undefined;
  const id = String(value).trim();
  return /^[1-9]\d{0,19}$/.test(id) ? id : undefined;
};

const decodeId = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    return validId(decodeURIComponent(value));
  } catch {
    return undefined;
  }
};

const route = (page: Page, ids: Omit<AppRoute, "page"> = {}): AppRoute => ({ page, ...ids });

export function parseAppLocation(pathname: string, search: string, fallbackPage: Page): AppRoute {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "app") return route(fallbackPage);

  const parts = segments.slice(1);
  const query = new URLSearchParams(search);
  const first = parts[0];
  const second = parts[1];
  const third = parts[2];

  if (first === "admin" && second === "dashboard" && parts.length === 2) return route("admin-dashboard");
  if (first === "consultant" && second === "dashboard" && parts.length === 2) return route("consultant-dashboard");
  if (first === "properties") {
    if (parts.length === 1) return route("properties");
    if (second === "new" && parts.length === 2) return route("add-property");
    const propertyId = decodeId(second);
    if (!propertyId) return route("properties");
    if (parts.length === 2) return route("property-detail", { propertyId });
    if (third === "edit" && parts.length === 3) return route("edit-property", { propertyId });
    if (third === "reports" && parts.length === 3) return route("property-reports", { propertyId, propertyReportId: propertyId });
    return route("properties");
  }
  if (first === "property-files" || first === "listings" || first === "files") {
    if (parts.length === 1) return route("property-files");
    if (second === "explore" && parts.length === 2) return route("property-files-explore");
    if (second === "new" && parts.length === 2) {
      const propertyId = decodeId(query.get("property") || undefined);
      return route("create-property-file", propertyId ? { preselectedPropertyId: propertyId } : {});
    }
    const propertyFileId = decodeId(second);
    if (!propertyFileId) return route("property-files");
    if (parts.length === 2) return route("property-file-detail", { propertyFileId });
    if (third === "edit" && parts.length === 3) return route("edit-property-file", { propertyFileId });
    return route("property-files");
  }
  if (first === "consultants") {
    if (parts.length === 1) return route("consultants");
    if (second === "new" && parts.length === 2) return route("add-consultant");
    const consultantId = decodeId(second);
    if (!consultantId) return route("consultants");
    if (parts.length === 2) return route("consultants", { consultantId });
    if (third === "edit" && parts.length === 3) return route("edit-consultant", { consultantId });
    return route("consultants");
  }
  if (first === "follow-ups") {
    if (parts.length === 1) return route("follow-ups");
    if (second === "new" && parts.length === 2) return route("create-followup");
    const followupId = decodeId(second);
    if (followupId && third === "edit" && parts.length === 3) return route("edit-followup", { followupId });
    return route("follow-ups");
  }
  if (first === "tickets") {
    if (second === "new" && parts.length === 2) return route("create-ticket");
    const ticketPage = second === "sent" ? "tickets-sent" : second === "received" ? "tickets-received" : second === "all" ? "tickets-all" : null;
    if (ticketPage && parts.length === 2) return route(ticketPage);
    const ticketId = decodeId(third);
    if (ticketPage && ticketId && parts.length === 3) return route(ticketPage, { ticketId });
  }

  if (first === "requests") {
    if (parts.length === 1) return route("crm-property-cases");
    const crmRecordId = decodeId(second);
    if (parts.length === 2) return crmRecordId ? route("crm-property-cases", { crmRecordId }) : route("crm-property-cases");
    return route("crm-property-cases");
  }

  if (first === "inquiry-register" && parts.length === 1) {
    const crmRecordId = decodeId(query.get("id") || undefined);
    return crmRecordId ? route("crm-inquiry-register", { crmRecordId }) : route("crm-inquiry-register");
  }

  if (first === "property-register" && parts.length === 1) {
    const crmRecordId = decodeId(query.get("id") || query.get("case") || query.get("reviewRequest") || undefined);
    return crmRecordId ? route("crm-property-register", { crmRecordId }) : route("crm-property-register");
  }

  if (first === "crm" && ["property-cases", "inquiries", "contacts", "deals", "contracts", "introductions", "viewings"].includes(second || "")) {
    const crmPage: Page = second === "property-cases"
      ? "crm-property-cases"
      : second === "inquiries" ? "crm-inquiries"
      : second === "contacts" ? "crm-contacts"
      : second === "deals" ? "crm-deals"
      : second === "contracts" ? "crm-contracts"
      : second === "introductions" ? "crm-introductions" : "crm-viewings";
    if (parts.length === 2) {
      const crmRecordId = crmPage === "crm-introductions" ? decodeId(query.get("inquiry") || undefined) : undefined;
      return crmRecordId ? route(crmPage, { crmRecordId }) : route(crmPage);
    }
    const crmRecordId = decodeId(third);
    if (parts.length === 3) return crmRecordId ? route(crmPage, { crmRecordId }) : route(crmPage);
    return route(crmPage);
  }

  const staticRoutes: Record<string, Page> = {
    "my-properties": "my-properties",
    "all-properties": "all-properties",
    "my-property-files": "my-property-files",
    "my-listings": "my-property-files",
    "listings/explore": "property-files-explore",
    "property-files/explore": "property-files-explore",
    "my-tasks": "my-tasks",
    "my-follow-ups": "my-followups",
    "tasks/board": "tasks-kanban",
    "tasks/calendar": "tasks-calendar",
    "tasks/new": "create-task",
    "follow-ups/mine": "my-followups",
    activity: "activity",
    "settings/workspace": "settings-workspace",
    "settings/permissions": "settings-permissions",
    "settings/ranges": "settings-ranges",
    "settings/login-options": "settings-login-options",
    "settings/workflow": "crm-settings",
    "settings/deal-types": "crm-deal-types",
    districts: "manage-districts",
    "districts/list": "manage-districts",
    attributes: "manage-attributes",
    "profile": "my-profile",
    "profile/edit": "my-profile-edit",
    "profile/security": "my-profile-security",
    "crm": "crm-dashboard",
    "inbox": "crm-inbox",
    "crm/inbox": "crm-inbox",
    "reviews": "crm-reviews",
    "crm/reviews": "crm-reviews",
    "explore": "property-files-explore",
    "crm/property-register": "crm-property-register",
    "crm/property-cases": "crm-property-cases",
    "crm/inquiries": "crm-inquiries",
    "crm/introductions": "crm-introductions",
    "crm/viewings": "crm-viewings",
    "crm/contacts": "crm-contacts",
    "crm/pipelines": "crm-pipelines",
    "crm/explore": "crm-explore",
    "crm/deals": "crm-deals",
    "crm/contracts": "crm-contracts",
    "crm/finance": "crm-finance",
    "crm/deal-types": "crm-deal-types",
    "crm/reports": "crm-reports",
    "crm/settings": "crm-settings",
    guide: "guide",
    forgot: "forgot",
  };
  const staticPage = staticRoutes[parts.join("/")];
  return staticPage ? route(staticPage) : route(fallbackPage);
}

export function buildAppPath(page: Page, paramId?: string | number): string {
  const id = validId(paramId);
  switch (page) {
    case "admin-dashboard":
      return "/app/admin/dashboard/";
    case "consultant-dashboard":
      return "/app/consultant/dashboard/";
    case "properties":
      return "/app/properties/";
    case "my-properties":
      return "/app/my-properties/";
    case "all-properties":
      return "/app/all-properties/";
    case "add-property":
      return "/app/properties/new/";
    case "property-detail":
      return id ? `/app/properties/${id}/` : "/app/properties/";
    case "edit-property":
      return id ? `/app/properties/${id}/edit/` : "/app/properties/";
    case "property-reports":
      return id ? `/app/properties/${id}/reports/` : "/app/properties/";
    case "property-files":
      return "/app/property-files/";
    case "property-files-explore":
      return "/app/property-files/explore/";
    case "my-property-files":
      return "/app/my-property-files/";
    case "create-property-file":
      return `/app/property-files/new/${id ? `?property=${encodeURIComponent(id)}` : ""}`;
    case "property-file-detail":
      return id ? `/app/property-files/${id}/` : "/app/property-files/";
    case "edit-property-file":
      return id ? `/app/property-files/${id}/edit/` : "/app/property-files/";
    case "tasks-kanban":
      return "/app/tasks/board/";
    case "tasks-calendar":
      return "/app/tasks/calendar/";
    case "create-task":
      return "/app/tasks/new/";
    case "my-tasks":
      return "/app/my-tasks/";
    case "consultants":
      return id ? `/app/consultants/${id}/` : "/app/consultants/";
    case "add-consultant":
      return "/app/consultants/new/";
    case "edit-consultant":
      return id ? `/app/consultants/${id}/edit/` : "/app/consultants/";
    case "follow-ups":
      return "/app/follow-ups/";
    case "my-followups":
      return "/app/my-follow-ups/";
    case "create-followup":
      return "/app/follow-ups/new/";
    case "edit-followup":
      return id ? `/app/follow-ups/${id}/edit/` : "/app/follow-ups/";
    case "tickets-sent":
      return id ? `/app/tickets/sent/${id}/` : "/app/tickets/sent/";
    case "tickets-received":
      return id ? `/app/tickets/received/${id}/` : "/app/tickets/received/";
    case "tickets-all":
      return id ? `/app/tickets/all/${id}/` : "/app/tickets/all/";
    case "create-ticket":
      return "/app/tickets/new/";
    case "activity":
      return "/app/activity/";
    case "settings-workspace":
      return "/app/settings/workspace/";
    case "settings-permissions":
      return "/app/settings/permissions/";
    case "settings-ranges":
      return "/app/settings/ranges/";
    case "settings-login-options":
      return "/app/settings/login-options/";
    case "manage-districts":
      return "/app/districts/";
    case "districts":
      return "/app/districts/";
    case "manage-attributes":
      return "/app/attributes/";
    case "my-profile":
      return "/app/profile/";
    case "my-profile-edit":
      return "/app/profile/edit/";
    case "my-profile-security":
      return "/app/profile/security/";
    case "crm-dashboard":
      return "/app/crm/";
    case "crm-inbox":
      return "/app/crm/inbox/";
    case "crm-property-register":
      return id ? `/app/property-register/?id=${encodeURIComponent(id)}` : "/app/property-register/";
    case "crm-property-cases":
      return id ? `/app/crm/property-cases/${id}/` : "/app/crm/property-cases/";
    case "crm-reviews":
      return "/app/reviews/";
    case "crm-inquiries":
      return id ? `/app/crm/inquiries/${id}/` : "/app/crm/inquiries/";
    case "crm-inquiry-register":
      return id ? `/app/inquiry-register/?id=${encodeURIComponent(id)}` : "/app/inquiry-register/";
    case "crm-introductions":
      return id ? `/app/crm/introductions/?inquiry=${encodeURIComponent(id)}` : "/app/crm/introductions/";
    case "crm-viewings":
      return "/app/crm/viewings/";
    case "crm-contacts":
      return id ? `/app/crm/contacts/${id}/` : "/app/crm/contacts/";
    case "crm-pipelines":
      return "/app/crm/pipelines/";
    case "crm-explore":
      return "/app/crm/explore/";
    case "crm-deals":
      return id ? `/app/crm/deals/${id}/` : "/app/crm/deals/";
    case "crm-contracts":
      return id ? `/app/crm/contracts/${id}/` : "/app/crm/contracts/";
    case "crm-finance":
      return "/app/crm/finance/";
    case "crm-deal-types":
      return "/app/crm/deal-types/";
    case "crm-reports":
      return "/app/crm/reports/";
    case "crm-settings":
      return "/app/crm/settings/";
    case "guide":
      return "/app/guide/";
    case "forgot":
      return "/app/forgot/";
    case "login":
      return "/accounts/login/";
    default:
      return "/app/";
  }
}

export function getPageTitle(page: Page, detailTitle?: string | null): string {
  const title = detailTitle?.trim() || PAGE_TITLES[page];
  return `${title} | زمینکس`;
}
