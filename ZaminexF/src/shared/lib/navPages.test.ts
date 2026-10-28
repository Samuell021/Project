import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Sidebar } from "../../features/auth/Sidebar";
import { getRoleNavPages } from "./navPages";
import { NAVIGATION_GROUPS, getNavigationGroups, getSettingsEntries, navigationStorageKey, readExpandedGroups } from "./navigation";
import { buildAppPath, parseAppLocation } from "./appRouting";
import { ALL_PERMISSION_CODES, pageIsAllowed, PermissionProvider } from "./permissions";
import type { Role } from "./types";

const roles: Role[] = ["admin", "range_manager", "consultant", "finance"];

function renderSidebar(role: Role, permissions: string[] | null = null, collapsed = false) {
  return renderToStaticMarkup(createElement(PermissionProvider, {
    permissions,
    children: createElement(Sidebar, {
      role, page: "crm-inbox", navigate: () => {}, collapsed, setCollapsed: () => {},
      userName: "کاربر آزمون", onLogout: () => {},
    }),
  }));
}

describe("shared navigation registry", () => {
  it("defines the six ordered groups", () => {
    expect(NAVIGATION_GROUPS.map((group) => group.heading)).toEqual([
      "فضای کار", "پرونده‌ها", "پیگیری عملیات", "قرارداد و مالی", "مدیریت کاربران و دسترسی", "تنظیمات و راهنما",
    ]);
  });

  it("keeps every settings destination inside the navigation groups", () => {
    for (const role of roles) {
      const markup = renderSidebar(role);
      expect(markup).toContain('aria-label="تنظیمات"');
      for (const entry of getSettingsEntries(role)) expect(getRoleNavPages(role).some((item) => item.page === entry.page)).toBe(true);
    }
    const settingsGroup = NAVIGATION_GROUPS.find((group) => group.id === "settings");
    const pages = settingsGroup?.items.map((item) => item.page) || [];
    for (const page of ["crm-deal-types", "manage-districts", "settings-workspace", "guide"] as const) expect(pages).toContain(page);
  });

  it.each(roles)("uses the same destinations for the %s sidebar and command search", (role) => {
    const groups = getNavigationGroups(role);
    const commands = getRoleNavPages(role);
    const sidebarPages = groups.flatMap((group) => group.items.map((item) => item.page));
    expect(commands.slice(0, sidebarPages.length).map((item) => item.page)).toEqual(sidebarPages);
    expect(new Set(commands.map((item) => item.page)).size).toBe(commands.length);
    const markup = renderSidebar(role);
    for (const item of commands) {
      if (item.section === "تنظیمات" || item.section === "پروفایل") continue;
      expect(markup).toContain(item.label);
    }
  });

  it.each(roles)("round trips every %s navigation destination", (role) => {
    for (const item of getRoleNavPages(role)) {
      const url = new URL(buildAppPath(item.page), "https://example.test");
      expect(parseAppLocation(url.pathname, url.search, "login").page).toBe(item.page);
    }
  });

  it("keeps legacy capabilities reachable", () => {
    const pages = getRoleNavPages("admin").map((item) => item.page);
    for (const page of ["tasks-kanban", "tasks-calendar", "create-task", "add-property", "create-property-file", "tickets-received", "create-ticket", "consultants", "add-consultant", "activity", "manage-districts", "manage-attributes", "settings-workspace", "settings-permissions", "settings-login-options", "settings-ranges", "crm-settings", "crm-deal-types", "guide", "my-profile-security"]) {
      expect(pages).toContain(page);
    }
  });

  it("keeps one dashboard destination and puts my tasks in the workspace group", () => {
    const adminGroups = getNavigationGroups("admin");
    const pages = getRoleNavPages("admin").map((item) => item.page);
    expect(pages.filter((page) => page === "admin-dashboard")).toHaveLength(1);
    expect(pages).not.toContain("crm-dashboard");
    expect(adminGroups.find((group) => group.heading === "فضای کار")?.items.map((item) => item.page)).toEqual([
      "admin-dashboard", "my-tasks", "crm-inbox", "activity",
    ]);
    expect(getRoleNavPages("consultant").map((item) => item.page)).toContain("consultant-dashboard");
  });

  it("keeps offering files, registration and review in a single cases group", () => {
    const cases = getNavigationGroups("admin").find((group) => group.heading === "پرونده‌ها");
    expect(cases?.items.find((item) => item.page === "property-files")?.label).toBe("فایل‌های عرضه");
    expect(cases?.items.find((item) => item.page === "property-files-explore")?.label).toBe("اکسپلور فایل‌های عرضه");
    expect(cases?.items.some((item) => item.page === "crm-explore")).toBe(false);
    expect(cases?.items.some((item) => item.page === "crm-property-register")).toBe(false);
    expect(cases?.items.find((item) => item.page === "add-property")?.label).toBe("ثبت پرونده");
    expect(cases?.items.find((item) => item.page === "crm-inquiry-register")?.label).toBe("ثبت درخواست متقاضی");
    expect(cases?.items.find((item) => item.page === "crm-reviews")?.label).toBe("صف بررسی");
    expect(cases?.items.find((item) => item.page === "add-property")?.label).toBe("ثبت پرونده");
  });

  it("uses role-specific property and file labels without parallel lists", () => {
    const items = getRoleNavPages("consultant");
    expect(items.find((item) => item.page === "my-properties")?.label).toBe("املاک من");
    expect(items.find((item) => item.page === "my-property-files")?.label).toBe("فایل‌های عرضه من");
    expect(items.some((item) => item.page === "properties")).toBe(false);
    expect(items.some((item) => item.page === "property-files")).toBe(false);
  });

  it("offers the operations pipeline to the admin and to the consultant panel", () => {
    const operationsPages = (role: Role) =>
      getNavigationGroups(role).find((group) => group.heading === "پیگیری عملیات")?.items.map((item) => item.page) || [];
    // The admin sees every board; a consultant sees the same board narrowed to their own records.
    for (const role of ["admin", "consultant"] as Role[]) {
      expect(getRoleNavPages(role).map((item) => item.page)).toContain("crm-pipelines");
      expect(operationsPages(role)).toContain("crm-pipelines");
      expect(renderSidebar(role, ["pipeline.view"])).toContain("کاریز عملیات");
    }
    // The supervisory and finance panels stay without it.
    for (const role of ["range_manager", "finance"] as Role[]) {
      expect(getRoleNavPages(role).map((item) => item.page)).not.toContain("crm-pipelines");
      expect(operationsPages(role)).not.toContain("crm-pipelines");
      expect(renderSidebar(role, ["pipeline.view"])).not.toContain("کاریز عملیات");
    }
    for (const page of ["crm-introductions", "crm-viewings", "my-followups", "tickets-received"]) {
      expect(operationsPages("consultant")).toContain(page);
    }
    expect(renderSidebar("admin")).toContain("کاریز عملیات");
  });

  it("opens the operations pipeline address for the admin and the consultant only", () => {
    const page = parseAppLocation("/app/crm/pipelines/", "", "login").page;
    expect(page).toBe("crm-pipelines");
    expect(buildAppPath("crm-pipelines")).toBe("/app/crm/pipelines/");
    for (const role of ["admin", "consultant"] as Role[]) {
      expect(pageIsAllowed(page, role)).toBe(true);
      expect(pageIsAllowed(page, role, [])).toBe(true);
      expect(pageIsAllowed(page, role, ALL_PERMISSION_CODES)).toBe(true);
    }
    // No permission set widens the board to the supervising roles.
    for (const role of ["range_manager", "finance"] as Role[]) {
      expect(pageIsAllowed(page, role)).toBe(false);
      expect(pageIsAllowed(page, role, ["pipeline.view"])).toBe(false);
      expect(pageIsAllowed(page, role, ALL_PERMISSION_CODES)).toBe(false);
    }
  });

  it("keeps the admin panel to one registration entry inside the records group", () => {
    const cases = getNavigationGroups("admin").find((group) => group.heading === "پرونده‌ها");
    const casesPages = cases?.items.map((item) => item.page) || [];
    expect(casesPages).not.toContain("crm-property-register");
    expect(casesPages.filter((page) => page === "add-property")).toHaveLength(1);
    expect(getRoleNavPages("consultant").map((item) => item.page)).not.toContain("crm-property-register");
  });

  it("keeps only staff entries in the admin access group", () => {
    const people = getNavigationGroups("admin").find((group) => group.heading === "مدیریت کاربران و دسترسی");
    expect(people?.items.map((item) => item.page)).toEqual(["consultants", "add-consultant"]);
    expect(people?.items.map((item) => item.label)).toEqual(["کارکنان", "افزودن کارمند"]);
    // The same records stay reachable for the admin as tabs of the settings surface.
    const settingsTabs = getSettingsEntries("admin").map((entry) => entry.page);
    expect(settingsTabs).toContain("settings-permissions");
    expect(settingsTabs).toContain("settings-ranges");
    // Range managers keep their own access entry.
    expect(getRoleNavPages("range_manager").map((item) => item.page)).toContain("settings-ranges");
  });

  it("titles the admin base-data group for what it holds", () => {
    const adminSettings = getNavigationGroups("admin").find((group) => group.id === "settings");
    expect(adminSettings?.heading).toBe("اطلاعات پایه");
    expect(adminSettings?.items.map((item) => item.label)).toEqual(["مدیریت مناطق", "ویژگی‌ها"]);
    expect(adminSettings?.items.map((item) => item.page)).toEqual(["manage-districts", "manage-attributes"]);
    const markup = renderSidebar("admin");
    expect(markup).toContain(">اطلاعات پایه<");
    expect(markup).toContain("مدیریت مناطق");
    expect(markup).not.toContain("اطلاعات پایه و ویژگی‌ها");
    for (const label of ["انواع معامله", "تنظیمات فضای کاری", "راهنمای ساختار", "گزینه‌های ورود", "تنظیمات جریان"]) {
      expect(markup).not.toContain(`>${label}<`);
    }
    // Other roles keep the previous settings group unchanged.
    const rangeSettings = getNavigationGroups("range_manager").find((group) => group.id === "settings");
    expect(rangeSettings?.heading).toBe("تنظیمات و راهنما");
    expect(rangeSettings?.items.map((item) => item.page)).toContain("settings-workspace");
    expect(renderSidebar("range_manager")).toContain("تنظیمات و راهنما");
  });

  it("leaves the settings group out of the consultant panel", () => {
    expect(getNavigationGroups("consultant").some((group) => group.id === "settings")).toBe(false);
    const markup = renderSidebar("consultant");
    expect(markup).not.toContain("تنظیمات و راهنما");
    expect(markup).not.toContain("aria-label=\"تنظیمات و راهنما\"");
    for (const label of ["تنظیمات فضای کاری", "راهنمای ساختار", "مدیریت مناطق", "ویژگی‌ها"]) {
      expect(markup).not.toContain(`>${label}<`);
    }
    // The footer settings button stays as the consultant's single settings entry point.
    expect(markup).toContain('aria-label="تنظیمات"');
  });

  it("orders every group by topic and marks where the divider goes", () => {
    const groupLabels = (role: Role, heading: string) =>
      getNavigationGroups(role).find((group) => group.heading === heading)?.items.map((item) => item.label) || [];
    const divided = (role: Role, heading: string) =>
      (getNavigationGroups(role).find((group) => group.heading === heading)?.items || [])
        .filter((item) => item.separatorBefore)
        .map((item) => item.label);

    expect(groupLabels("admin", "فضای کار")).toEqual(["نمای کلی", "کارهای من", "کارتابل پذیرش", "اعلان‌ها و سوابق"]);
    expect(groupLabels("consultant", "فضای کار")).toEqual(["نمای کلی", "کارهای من", "کارتابل پذیرش", "اعلان‌ها و سوابق"]);
    expect(groupLabels("admin", "پرونده‌ها")).toEqual([
      "اشخاص", "ثبت پرونده", "پرونده‌های ثبت ملک", "صف بررسی",
      "ثبت درخواست متقاضی", "درخواست متقاضیان",
      "املاک", "فایل‌های عرضه", "اکسپلور فایل‌های عرضه", "ساخت فایل",
    ]);
    expect(divided("admin", "پرونده‌ها")).toEqual(["ثبت پرونده", "ثبت درخواست متقاضی", "املاک"]);
    expect(groupLabels("consultant", "پرونده‌ها")).toEqual([
      "اشخاص", "ثبت پرونده", "پرونده‌های ثبت ملک",
      "ثبت درخواست متقاضی", "درخواست متقاضیان",
      "املاک من", "فایل‌های عرضه من", "اکسپلور فایل‌های عرضه", "ساخت فایل",
    ]);
    expect(groupLabels("admin", "پیگیری عملیات")).toEqual([
      "کاریز عملیات", "معرفی‌ها", "بازدیدها و تقویم", "پیگیری‌ها", "ایجاد پیگیری",
      "تیکت‌ها", "ثبت تیکت", "تخته کارها", "تقویم کارها", "افزودن کار",
    ]);
    expect(divided("admin", "پیگیری عملیات")).toEqual(["معرفی‌ها", "تیکت‌ها", "تخته کارها"]);
    expect(groupLabels("consultant", "پیگیری عملیات")).toEqual([
      "کاریز عملیات", "معرفی‌ها", "بازدیدها و تقویم", "پیگیری‌های من", "ایجاد پیگیری",
      "تیکت‌ها", "ثبت تیکت", "تخته کارها", "تقویم کارها", "افزودن کار",
    ]);
    expect(divided("consultant", "پیگیری عملیات")).toEqual(["معرفی‌ها", "تیکت‌ها", "تخته کارها"]);
    expect(groupLabels("admin", "قرارداد و مالی")).toEqual(["مذاکرات", "قراردادها", "کمیسیون و وجوه", "گزارش‌ها"]);
    expect(divided("admin", "قرارداد و مالی")).toEqual(["کمیسیون و وجوه"]);
    expect(groupLabels("admin", "مدیریت کاربران و دسترسی")).toEqual(["کارکنان", "افزودن کارمند"]);
    expect(groupLabels("admin", "اطلاعات پایه")).toEqual(["مدیریت مناطق", "ویژگی‌ها"]);

    // Markers never stack: one divider between two clusters, never two in a row.
    for (const role of roles) {
      for (const group of getNavigationGroups(role)) {
        expect(group.items.some((item, index) => item.separatorBefore && group.items[index - 1]?.separatorBefore)).toBe(false);
      }
    }
  });

  it("filters destinations by the same permissions as direct routes", () => {
    const permissions = ["scope.manage", "case.view"];
    const items = getRoleNavPages("range_manager", permissions);
    expect(items.some((item) => item.page === "crm-finance")).toBe(false);
    expect(items.some((item) => item.page === "crm-settings")).toBe(false);
    for (const item of items) expect(pageIsAllowed(item.page, "range_manager", permissions)).toBe(true);
  });

  it("offers finance only the contract and finance surfaces", () => {
    const pages = getRoleNavPages("finance", ["finance.view", "profile.edit"]).map((item) => item.page);
    expect(pages).toContain("crm-finance");
    expect(pages).toContain("crm-reports");
    expect(pages).toContain("crm-contracts");
    expect(pages).toContain("my-tasks");
    for (const page of ["crm-contacts", "crm-deals", "crm-inbox", "consultants", "properties", "crm-property-cases"]) expect(pages).not.toContain(page);
  });

  it("starts every group closed and keeps its content hidden", () => {
    const markup = renderSidebar("admin");
    const groupCount = getNavigationGroups("admin").length;
    expect(markup.match(/aria-expanded="false"/g)?.length).toBe(groupCount);
    expect(markup.match(/hidden=""/g)?.length).toBe(groupCount);
    expect(markup).toContain('aria-current="page"');
  });

  it("keeps collapsed group controls labelled", () => {
    const markup = renderSidebar("admin", null, true);
    for (const group of getNavigationGroups("admin")) expect(markup).toContain(`aria-label="${group.heading}"`);
    expect(markup).toContain('aria-label="خروج"');
  });
});

describe("navigation preferences", () => {
  const storage = (value: string | null) => ({ getItem: () => value });

  it("defaults to closed for absent, invalid, or inaccessible preferences", () => {
    for (const value of [null, "broken", "null", "{}", "42"]) expect(readExpandedGroups(storage(value), "key")).toEqual([]);
    expect(readExpandedGroups({ getItem: () => { throw new Error("unavailable"); } }, "key")).toEqual([]);
  });

  it("retains only known groups in registry order", () => {
    expect(readExpandedGroups(storage('["operations","workspace","settings","unknown","workspace",12]'), "key")).toEqual(["workspace", "operations", "settings"]);
  });

  it("isolates preferences by user identifier", () => {
    expect(navigationStorageKey("12")).not.toBe(navigationStorageKey("21"));
    expect(navigationStorageKey("a:b")).not.toBe(navigationStorageKey("a%3Ab"));
  });
});
