// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Pipelines } from "./pages/PipelinesPage";
import { PermissionProvider } from "../../shared/lib/permissions";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function card(id: number, title: string) {
  return {
    id,
    code: `LD-${id}`,
    title,
    subtitle: "",
    stage: "in_progress",
    stage_label: "در جریان",
    owner: "کارشناس نمونه",
    due_at: null,
    stage_entered_at: null,
    days_in_stage: 2,
    stalled: false,
    record_page: "crm-inbox",
    warnings: [],
    transitions: [],
  };
}

// What the server answers for a consultant: five boards, contract board left out.
const AVAILABLE = [
  { kind: "leads", label: "سرنخ و ارجاع" },
  { kind: "listings", label: "فایل عرضه" },
  { kind: "inquiries", label: "درخواست متقاضی" },
  { kind: "deals", label: "مذاکره" },
  { kind: "tasks", label: "وظایف" },
];

function board(overrides: Record<string, unknown> = {}) {
  return {
    kind: "leads",
    requested_kind: "leads",
    label: "سرنخ و ارجاع",
    stages: [
      { code: "new", label: "جدید", count: 0, cards: [] },
      { code: "in_progress", label: "در جریان", count: 1, cards: [card(7, "پرونده خود من")] },
    ],
    total: 1,
    stalled: 0,
    stall_threshold_days: 7,
    available: AVAILABLE,
    filters: {},
    ...overrides,
  };
}

describe("consultant operations pipeline", () => {
  const originalFetch = globalThis.fetch;
  let requested: string[];
  let payloads: Record<string, unknown>;

  beforeEach(() => {
    requested = [];
    payloads = {};
    window.history.replaceState({}, "", "/app/crm/pipelines/");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/crm/api/pipelines/")) {
        const kind = url.split("/crm/api/pipelines/")[1]?.split("/")[0] || "leads";
        return jsonResponse(payloads[kind] ?? board({ kind, requested_kind: kind }));
      }
      if (url.includes("/crm/api/staff/")) return jsonResponse({ detail: "شما به این بخش دسترسی ندارید." }, 403);
      return jsonResponse({ results: [] });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  function renderBoard(permissions: string[] = ["case.view", "pipeline.view"]) {
    return render(
      <PermissionProvider permissions={permissions}>
        <Pipelines csrfToken="token" navigate={() => {}} role="consultant" />
      </PermissionProvider>,
    );
  }

  it("loads the consultant's own board instead of an access notice", async () => {
    renderBoard();
    expect(await screen.findByText("پرونده خود من")).toBeTruthy();
    expect(window.location.pathname).toBe("/app/crm/pipelines/");
    // No refusal wording anywhere on the page.
    expect(document.body.textContent).not.toMatch(/دسترسی ندارید|دسترسی به این بخش/);
    expect(requested.some((url) => url.includes("/crm/api/pipelines/leads/"))).toBe(true);
  });

  it("never asks for the staff list the consultant may not read", async () => {
    renderBoard();
    await screen.findByText("پرونده خود من");
    await waitFor(() => expect(requested.some((url) => url.includes("/crm/api/deal-types/"))).toBe(true));
    expect(requested.some((url) => url.includes("/crm/api/staff/"))).toBe(false);
    // The remaining reference lookups are allowed and still loaded.
    expect(requested.some((url) => url.includes("/crm/api/scopes/"))).toBe(true);
  });

  it("drops the supervisor-only controls from a consultant's board", async () => {
    renderBoard();
    await screen.findByText("پرونده خود من");
    // Team/mine switch and the owner filter belong to a supervisor.
    expect(screen.queryByRole("group", { name: "نمای کاریز" })).toBeNull();
    expect(screen.queryByRole("button", { name: "تیم" })).toBeNull();
    expect(screen.queryByRole("button", { name: "من" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "فیلترها" }));
    expect(screen.queryByText("مسئول")).toBeNull();
    expect(screen.getByText("رنج")).toBeTruthy();
    expect(screen.getByText("نوع معامله")).toBeTruthy();
    expect(screen.getByText("اولویت")).toBeTruthy();
  });

  it("shows only the pipelines the server offers the consultant", async () => {
    renderBoard();
    const tablist = await screen.findByRole("tablist", { name: "انتخاب کاریز" });
    const labels = within(tablist).getAllByRole("tab").map((tab) => tab.textContent);
    expect(labels).toEqual(["سرنخ و ارجاع", "فایل عرضه", "درخواست متقاضی", "مذاکره", "وظایف"]);
    // The contract board is not part of the consultant panel.
    expect(labels).not.toContain("قرارداد");
  });

  it("explains that the board holds the consultant's own records", async () => {
    renderBoard();
    await screen.findByText("پرونده خود من");
    expect(document.body.textContent).toContain("این کاریز فقط رکوردهای خود شما را نشان می‌دهد");
  });

  it("stays on an empty board instead of falling back to an error", async () => {
    payloads.leads = board({
      stages: [{ code: "new", label: "جدید", count: 0, cards: [] }],
      total: 0,
    });
    renderBoard();
    expect(await screen.findByText("رکوردی در این مرحله نیست")).toBeTruthy();
    expect(screen.queryByText("کاریز بارگذاری نشد")).toBeNull();
    expect(screen.getByText(/۰ رکورد/)).toBeTruthy();
  });

  it("falls back to a board the consultant owns when an address asks for the contract board", async () => {
    // The server never offers the contract board to a consultant: it answers with the first board
    // that consultant may read and reports which kind was actually requested.
    payloads.contracts = board({ kind: "leads", requested_kind: "contracts" });
    window.history.replaceState({}, "", "/app/crm/pipelines/?kind=contracts");
    renderBoard();
    // The server answers with the first board the consultant may read, and the tab follows it.
    await waitFor(() => expect(requested.some((url) => url.includes("/crm/api/pipelines/contracts/"))).toBe(true));
    const tablist = await screen.findByRole("tablist", { name: "انتخاب کاریز" });
    await waitFor(() => {
      const selected = within(tablist).getAllByRole("tab").filter((tab) => tab.getAttribute("aria-selected") === "true");
      expect(selected).toHaveLength(1);
      expect(selected[0].textContent).toBe("سرنخ و ارجاع");
    });
    // The address no longer asks for a board the consultant cannot read.
    expect(window.location.search).not.toContain("kind=contracts");
    expect(document.body.textContent).not.toMatch(/دسترسی ندارید/);
  });

  it("keeps the supervisor toolbar for the admin board", async () => {
    render(
      <PermissionProvider permissions={["case.view", "pipeline.view", "staff.manage"]}>
        <Pipelines csrfToken="token" navigate={() => {}} role="admin" />
      </PermissionProvider>,
    );
    expect(await screen.findByRole("group", { name: "نمای کاریز" })).toBeTruthy();
    await waitFor(() => expect(requested.some((url) => url.includes("/crm/api/staff/"))).toBe(true));
    expect(document.body.textContent).toContain("هر کارت یک رکورد واقعی است");
  });
});
