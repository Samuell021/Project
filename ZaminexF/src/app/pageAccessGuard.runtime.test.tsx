// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import AppRouter from "./App";
import type { Role } from "../shared/lib/types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let requested: string[] = [];

function renderAt(path: string, role: Role, permissions: string[] | null) {
  window.history.replaceState({}, "", path);
  return render(
    <AppRouter
      initialData={{
        isAuthenticated: true,
        loginUrl: "/accounts/login/",
        logoutUrl: "/accounts/logout/",
        csrfToken: "test-token",
        role,
        permissions: permissions ?? undefined,
        userName: "کاربر آزمون",
        currentConsultantId: "1",
        initialPage: "crm-pipelines",
        next: "",
      }}
    />,
  );
}

const boardRequests = () => requested.filter((url) => url.includes("/crm/api/pipelines/"));

describe("page access guard", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    requested = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/crm/api/finance/overview/")) {
        return jsonResponse({
          contracts: [],
          totals: { claimed: "0", received: "0", shares_paid: "0", outstanding: "0" },
          claim_count: 0,
          payment_count: 0,
        });
      }
      return jsonResponse({ results: [] });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("keeps the operations pipeline address and its board for the admin", async () => {
    renderAt("/app/crm/pipelines/", "admin", ["pipeline.view"]);
    await waitFor(() => expect(document.title).toBe("کاریز عملیات | زمینکس"), { timeout: 3000 });
    await waitFor(() => expect(boardRequests().length).toBeGreaterThan(0), { timeout: 3000 });
    expect(window.location.pathname).toBe("/app/crm/pipelines/");
  });

  it("keeps the same board inside the consultant panel, scoped to that consultant", async () => {
    renderAt("/app/crm/pipelines/", "consultant", ["case.view", "pipeline.view"]);
    await waitFor(() => expect(document.title).toBe("کاریز عملیات | زمینکس"), { timeout: 3000 });
    await waitFor(() => expect(boardRequests().length).toBeGreaterThan(0), { timeout: 3000 });
    // The address stays put: no redirect to the dashboard and no "no access" page.
    expect(window.location.pathname).toBe("/app/crm/pipelines/");
    expect(screen.queryByText(/دسترسی/)).toBeNull();
  });

  it.each([
    ["range_manager", ["pipeline.view", "analytics.view"], "/app/admin/dashboard/", "داشبورد مدیریت"],
    ["finance", ["pipeline.view", "finance.view"], "/app/crm/finance/", "کمیسیون و وجوه"],
  ] as Array<[Role, string[], string, string]>)(
    "turns a %s manual pipeline address into that role's own landing page without loading the board",
    async (role, permissions, path, title) => {
      renderAt("/app/crm/pipelines/", role, permissions);
      await waitFor(() => expect(window.location.pathname).toBe(path));
      expect(document.title).toContain(title);
      expect(boardRequests()).toEqual([]);
    },
  );
});
