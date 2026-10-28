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

function card(id: number) {
  return {
    id,
    code: `LD-${id}`,
    title: `رکورد ${id}`,
    subtitle: "",
    stage: "new",
    stage_label: "جدید",
    owner: "مشاور",
    due_at: null,
    stage_entered_at: null,
    days_in_stage: 1,
    stalled: false,
    record_page: "crm-inbox",
    warnings: [],
    transitions: [],
  };
}

const BOARD = {
  kind: "leads",
  requested_kind: "leads",
  label: "سرنخ و ارجاع",
  stages: [
    { code: "new", label: "جدید", count: 2, cards: [card(1), card(2)] },
    { code: "contacted", label: "تماس گرفته‌شده", count: 1, cards: [card(3)] },
  ],
  total: 12,
  stalled: 3,
  stall_threshold_days: 7,
  available: [{ kind: "leads", label: "سرنخ و ارجاع" }],
  filters: {},
};

describe("operations pipeline toolbar", () => {
  const originalFetch = globalThis.fetch;
  let requested: string[];

  beforeEach(() => {
    requested = [];
    window.history.replaceState({}, "", "/app/crm/pipelines/");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/crm/api/pipelines/")) return jsonResponse(BOARD);
      return jsonResponse({ results: [] });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function renderBoard() {
    return render(
      <PermissionProvider permissions={null}>
        <Pipelines csrfToken="token" navigate={() => {}} />
      </PermissionProvider>,
    );
  }

  it("keeps the filter icon on the same row as its label", async () => {
    renderBoard();
    const filterButton = await screen.findByRole("button", { name: "فیلترها" });
    const row = filterButton.firstElementChild;
    expect(row?.tagName).toBe("SPAN");
    expect(row?.className).toContain("inline-flex");
    expect(row?.className).toContain("items-center");
    expect(row?.querySelector("svg")).not.toBeNull();
    expect(row?.textContent).toBe("فیلترها");
  });

  it("lands the team/mine switch at the left end of the toolbar with an icon per option", async () => {
    renderBoard();
    const group = await screen.findByRole("group", { name: "نمای کاریز" });
    const team = within(group).getByRole("button", { name: "تیم" });
    const mine = within(group).getByRole("button", { name: "من" });
    for (const option of [team, mine]) {
      expect(option.className).toContain("inline-flex");
      expect(option.className).toContain("items-center");
      expect(option.querySelector("svg")).not.toBeNull();
    }
    expect(team.getAttribute("aria-pressed")).toBe("true");
    expect(mine.getAttribute("aria-pressed")).toBe("false");
    expect(team.className).toContain("bg-emerald-700");

    // RTL row: the last child sits at the physical left, and the switch is rendered after the
    // record counter that `mr-auto` pushes away from the filters.
    const toolbar = group.parentElement;
    expect(toolbar?.lastElementChild).toBe(group);
    const counter = within(toolbar as HTMLElement).getByText(/رکورد/);
    expect(counter.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("switches the board between team and personal views", async () => {
    renderBoard();
    const group = await screen.findByRole("group", { name: "نمای کاریز" });
    await waitFor(() => expect(requested.some((url) => url.includes("/crm/api/pipelines/"))).toBe(true));
    expect(requested.some((url) => url.includes("mine=1"))).toBe(false);

    fireEvent.click(within(group).getByRole("button", { name: "من" }));
    await waitFor(() => expect(requested.some((url) => url.includes("mine=1"))).toBe(true));
    expect(within(group).getByRole("button", { name: "من" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(group).getByRole("button", { name: "تیم" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the board inside the viewport so long columns do not grow the page", async () => {
    renderBoard();
    const column = await screen.findByRole("region", { name: "ستون جدید" });
    // Page shell owns the height instead of the document growing.
    const shell = column.closest("div.h-full");
    expect(shell).not.toBeNull();
    expect((shell as HTMLElement).className).toContain("min-h-0");
    expect((shell as HTMLElement).className).toContain("flex-col");
    // Guarded, so the page can never add a second scrollbar to the shell's scroll container.
    expect((shell as HTMLElement).className).toContain("overflow-hidden");
    // The board takes the leftover space, scrolls sideways only and never stretches the page.
    const board = column.parentElement as HTMLElement;
    expect(board.className).toContain("flex-1");
    expect(board.className).toContain("min-h-0");
    expect(board.className).toContain("overflow-x-auto");
    expect(board.className).toContain("overflow-y-hidden");
    // No fixed minimum height: a hard floor made the page taller than the viewport whenever the
    // filter panel was open or the window was short.
    expect(board.className).not.toContain("min-h-[18rem]");
    // Each column is a flex column whose card list is the only vertical scroller.
    expect(column.className).toContain("flex-col");
    const list = within(column).getByRole("list");
    expect(list.className).toContain("flex-1");
    expect(list.className).toContain("min-h-0");
    expect(list.className).toContain("overflow-y-auto");
    expect(within(column).getByText("رکورد 1")).toBeTruthy();
  });
});
