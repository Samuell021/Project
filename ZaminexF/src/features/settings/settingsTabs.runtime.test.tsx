// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AppRouter from "../../app/App";
import { SettingsPage } from "./pages/SettingsPage";
import { PermissionProvider } from "../../shared/lib/permissions";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SettingsPage inline tabs integration", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    window.history.replaceState({}, "", "/app/settings/workspace/");
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders workflow settings and deal types directly inside SettingsPage via AppRouter without leaving Settings tabs", async () => {
    const calls: { url: string; method: string; body?: any }[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method || "GET").toUpperCase();
      const parsedBody = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body: parsedBody });

      if (url.includes("/accounts/me/permissions/")) {
        return jsonResponse({ role: "ADMIN", permissions: ["login.settings", "company.edit", "dealtype.manage"] });
      }
      if (url.includes("/common/api/company-settings/")) {
        return jsonResponse({
          companyName: "هلدینگ زمینکس",
          licenseNumber: "1405",
          email: "info@zaminex.ir",
          phone: "02188000000",
          address: "تهران",
          brandTheme: "green",
        });
      }
      if (url.includes("/crm/api/workflow-settings/current/")) {
        if (method === "PATCH") {
          return jsonResponse({ ...parsedBody, updated_at: "1405/08/01", updated_by_name: "مدیر کل" });
        }
        return jsonResponse({
          assignment_waiting_hours: 36,
          default_assignment_due_days: 7,
          withdrawal_decision_note_required: true,
          extension_decision_note_required: false,
        });
      }
      if (url.includes("/crm/api/deal-type-versions/")) {
        return jsonResponse({
          count: 1,
          next: null,
          results: [{ id: 1, deal_type_name: "فروش قطعی", version_number: 1, status: "PUBLISHED", family: "SALE" }],
        });
      }
      if (url.includes("/basics/api/deal-types/")) {
        return jsonResponse([{ id: 1, name: "sale", display_name: "فروش قطعی" }]);
      }
      return jsonResponse([]);
    }) as typeof fetch;

    render(
      <AppRouter
        initialData={{
          isAuthenticated: true,
          loginUrl: "/accounts/login/",
          logoutUrl: "/accounts/logout/",
          csrfToken: "csrf-test",
          role: "admin",
          permissions: ["login.settings", "company.edit", "dealtype.manage"],
          userName: "مدیر ارشد",
          currentConsultantId: "1",
          initialPage: "settings-workspace",
          next: "/",
        }}
      />,
    );

    const tablist = await screen.findByRole("tablist", { name: "بخش‌های تنظیمات" });
    const tabLabels = within(tablist).getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabLabels).toEqual([
      "فضای کاری",
      "دسترسی‌ها",
      "رنج‌ها",
      "تنظیمات گردش کار",
      "انواع معامله",
      "گزینه‌های ورود",
      "راهنمای ساختار",
    ]);

    // Switch to Workflow Settings tab — Settings tab bar MUST stay mounted!
    fireEvent.click(within(tablist).getByRole("tab", { name: "تنظیمات گردش کار" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/app/crm/settings/");
      expect(
        within(screen.getByRole("tablist", { name: "بخش‌های تنظیمات" }))
          .getByRole("tab", { name: "تنظیمات گردش کار" })
          .getAttribute("aria-selected"),
      ).toBe("true");
    });
    expect(await screen.findByText("جریان ارجاع و پذیرش")).toBeTruthy();

    // Save workflow settings directly inside the tab
    fireEvent.submit(screen.getByText("ذخیره تنظیمات").closest("form")!);
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes("/crm/api/workflow-settings/current/") && c.method === "PATCH")).toBe(true);
    });

    // Click "نسخه‌های انواع معامله" shortcut inside Workflow Settings -> switches to Deal Types tab STILL inside SettingsPage!
    fireEvent.click(screen.getByRole("button", { name: "نسخه‌های انواع معامله" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/app/crm/deal-types/");
      expect(
        within(screen.getByRole("tablist", { name: "بخش‌های تنظیمات" }))
          .getByRole("tab", { name: "انواع معامله" })
          .getAttribute("aria-selected"),
      ).toBe("true");
    });
    expect(await screen.findByText("نام سیستمی")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("تنظیمات");
  });

  it("hides admin-only tabs from restricted non-admin users while keeping permitted deal-types inline", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/basics/api/deal-types/")) return jsonResponse([]);
      return jsonResponse({ results: [], count: 0 });
    }) as typeof fetch;

    const navigate = vi.fn();
    render(
      <PermissionProvider permissions={["dealtype.manage"]}>
        <SettingsPage page="crm-deal-types" navigate={navigate} role="range_manager" csrfToken="csrf-rm" />
      </PermissionProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: "بخش‌های تنظیمات" });
    expect(within(tablist).queryByRole("tab", { name: "تنظیمات گردش کار" })).toBeNull();
    expect(within(tablist).getByRole("tab", { name: "انواع معامله" }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText("نام سیستمی")).toBeTruthy();
  });

  it("lists roles as access-table columns and creates a custom role column from the table header", async () => {
    const calls: { url: string; method: string; body?: any }[] = [];
    const permissionRows = [
      { code: "property.view", label: "مشاهده فایل", group: "فایل", groupOrder: 1, order: 1 },
    ];
    let roleRows = [
      { code: "AGENT", name: "کارشناس", isLocked: false, isCustom: false, permissions: ["property.view"] },
    ];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method || "GET").toUpperCase();
      const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      if (url.includes("/accounts/role-permissions/")) {
        if (method === "POST") {
          roleRows = [
            ...roleRows,
            { code: "CUSTOM_1", name: body.name, isLocked: false, isCustom: true, permissions: [] },
          ];
          return jsonResponse({ permissions: permissionRows, roles: roleRows, canEdit: true }, 201);
        }
        return jsonResponse({ permissions: permissionRows, roles: roleRows, canEdit: true });
      }
      return jsonResponse({ results: [], count: 0 });
    }) as typeof fetch;

    render(
      <PermissionProvider role="admin">
        <SettingsPage page="settings-permissions" navigate={vi.fn()} role="admin" csrfToken="csrf-admin" />
      </PermissionProvider>,
    );

    const table = await screen.findByRole("table");
    expect(within(table).getByText("کارشناس")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "افزودن نقش" }));
    fireEvent.change(screen.getByPlaceholderText("مثلاً کارشناس پشتیبانی"), {
      target: { value: "کارشناس پشتیبانی" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ثبت نقش" }));

    await waitFor(() =>
      expect(within(screen.getByRole("table")).getByText("کارشناس پشتیبانی")).toBeTruthy(),
    );
    expect(
      calls.find((call) => call.url.includes("/accounts/role-permissions/") && call.method === "POST")
        ?.body,
    ).toEqual({ name: "کارشناس پشتیبانی" });
  });
})
