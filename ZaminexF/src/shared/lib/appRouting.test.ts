import { describe, expect, it } from "vitest";
import { buildAppPath, getPageTitle, parseAppLocation } from "./appRouting";

describe("app route mapping", () => {
  it("round-trips detail and edit routes with their identifiers", () => {
    const cases = [
      ["property-detail", 41, "/app/properties/41/", { propertyId: "41" }],
      ["edit-property", 42, "/app/properties/42/edit/", { propertyId: "42" }],
      ["property-reports", 43, "/app/properties/43/reports/", { propertyId: "43", propertyReportId: "43" }],
      ["property-file-detail", 44, "/app/property-files/44/", { propertyFileId: "44" }],
      ["edit-property-file", 45, "/app/property-files/45/edit/", { propertyFileId: "45" }],
      ["edit-consultant", 46, "/app/consultants/46/edit/", { consultantId: "46" }],
      ["edit-followup", 47, "/app/follow-ups/47/edit/", { followupId: "47" }],
      ["tickets-received", 48, "/app/tickets/received/48/", { ticketId: "48" }],
      ["crm-property-cases", 49, "/app/crm/property-cases/49/", { crmRecordId: "49" }],
      ["crm-inquiries", 50, "/app/crm/inquiries/50/", { crmRecordId: "50" }],
      ["crm-contacts", 51, "/app/crm/contacts/51/", { crmRecordId: "51" }],
    ] as const;

    cases.forEach(([page, id, expectedPath, ids]) => {
      const path = buildAppPath(page, id);
      expect(path).toBe(expectedPath);
      expect(parseAppLocation(path, "", "consultant-dashboard")).toEqual({ page, ...ids });
    });
  });

  it("preserves a preselected property in the propertyFile creation URL", () => {
    const path = buildAppPath("create-property-file", 73);
    const url = new URL(path, "https://crm.example");
    expect(`${url.pathname}${url.search}`).toBe("/app/property-files/new/?property=73");
    expect(parseAppLocation(url.pathname, url.search, "consultant-dashboard")).toEqual({
      page: "create-property-file",
      preselectedPropertyId: "73",
    });
  });

  it("maps static pages to independent paths", () => {
    const cases = [
      ["admin-dashboard", "/app/admin/dashboard/"],
      ["consultant-dashboard", "/app/consultant/dashboard/"],
      ["my-properties", "/app/my-properties/"],
      ["my-property-files", "/app/my-property-files/"],
      ["property-files-explore", "/app/property-files/explore/"],
      ["tasks-kanban", "/app/tasks/board/"],
      ["tasks-calendar", "/app/tasks/calendar/"],
      ["my-followups", "/app/my-follow-ups/"],
      ["settings-permissions", "/app/settings/permissions/"],
      ["settings-ranges", "/app/settings/ranges/"],
      ["my-profile-security", "/app/profile/security/"],
      ["crm-dashboard", "/app/crm/"],
      ["crm-settings", "/app/crm/settings/"],
      ["guide", "/app/guide/"],
    ] as const;

    cases.forEach(([page, expectedPath]) => {
      const path = buildAppPath(page);
      expect(path).toBe(expectedPath);
      expect(parseAppLocation(path, "", "consultant-dashboard").page).toBe(page);
    });
  });

  it("resolves explore before treating the second propertyFile segment as an ID", () => {
    for (const fallback of ["admin-dashboard", "consultant-dashboard"] as const) {
      expect(parseAppLocation("/app/property-files/explore/", "", fallback)).toEqual({ page: "property-files-explore" });
      expect(parseAppLocation("/app/property-files/explore", "?q=test", fallback).page).not.toBe("property-files");
      expect(parseAppLocation("/app/property-files/", "", fallback)).toEqual({ page: "property-files" });
    }
    expect(parseAppLocation("/app/property-files/explore/1/", "", "admin-dashboard")).toEqual({ page: "property-files" });
    expect(getPageTitle("property-files-explore")).toBe("اکسپلور فایل‌های عرضه | زمینکس");
  });

  it("rejects unsafe identifiers and falls back to the relevant list", () => {
    expect(parseAppLocation("/app/properties/%2F/", "", "consultant-dashboard")).toEqual({ page: "properties" });
    expect(parseAppLocation("/app/property-files/0/", "", "consultant-dashboard")).toEqual({ page: "property-files" });
    expect(parseAppLocation("/app/crm/property-cases/0/", "", "admin-dashboard")).toEqual({ page: "crm-property-cases" });
  });

  it("uses the current page title and a safe detail title", () => {
    expect(getPageTitle("property-detail")).toBe("جزئیات ملک | زمینکس");
    expect(getPageTitle("property-file-detail", "آپارتمان مرکزی")).toBe("آپارتمان مرکزی | زمینکس");
  });
});
