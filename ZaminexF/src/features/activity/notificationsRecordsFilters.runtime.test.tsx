// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationsRecordsPage } from "./pages/NotificationsRecordsPage";
import { toJalaliISO } from "../../shared/lib/jdate";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Call = { url: string; method: string };

const PERSIAN_YEAR = Number(
  new Intl.DateTimeFormat("en-US-u-ca-persian", { year: "numeric" })
    .format(new Date())
    .replace(/\D/g, ""),
);

function faNumber(value: number): string {
  return value.toLocaleString("fa-IR", { useGrouping: false });
}

function faToInt(value: string): number {
  const digits = "۰۱۲۳۴۵۶۷۸۹";
  return Number(
    value
      .split("")
      .map((char) => String(digits.indexOf(char)))
      .join(""),
  );
}

function calendarDayCells(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('[role="dialog"] button')).filter((button) =>
    /^[۰-۹]+$/.test((button.textContent || "").trim()),
  ) as HTMLButtonElement[];
}

function todayInTehran(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function notificationCalls(calls: Call[]): URL[] {
  return calls
    .filter((call) => call.url.includes("/common/api/notifications/"))
    .map((call) => new URL(call.url, "http://localhost"));
}

function lastNotificationQuery(calls: Call[]): URLSearchParams {
  const urls = notificationCalls(calls);
  return urls[urls.length - 1].searchParams;
}

describe("NotificationsRecordsPage filter bar", () => {
  const originalFetch = globalThis.fetch;
  let calls: Call[] = [];

  beforeEach(() => {
    calls = [];
    window.history.replaceState({}, "", "/app/activity/");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method || "GET").toUpperCase();
      calls.push({ url, method });
      if (url.includes("/common/api/notifications/")) {
        return jsonResponse({ notifications: [], unreadCount: 4 });
      }
      return jsonResponse({ results: [], count: 0 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function renderPage() {
    render(<NotificationsRecordsPage csrfToken="token" />);
    await screen.findByText("از تاریخ");
    await waitFor(() => expect(notificationCalls(calls).length).toBeGreaterThan(0));
  }

  it("lays the four filters out as an aligned grid instead of fixed-width, colliding cells", async () => {
    await renderPage();

    expect(screen.getByText("فیلترها")).toBeTruthy();

    const fromField = screen.getByText("از تاریخ").parentElement as HTMLElement;
    const grid = fromField.parentElement as HTMLElement;
    expect(grid.className).toContain("grid");
    expect(grid.className).toContain("items-end");
    expect(grid.className).toContain("gap-3");

    // The previous markup pinned every date field inside `w-44` (11rem) while
    // `JalaliDateInput` needs 13rem, so the fields overflowed and overlapped the
    // next cell. No cell may constrain them narrower than that minimum again.
    expect(grid.querySelector(".w-44")).toBeNull();
    expect(grid.children.length).toBe(4);
    grid.querySelectorAll(":scope > *").forEach((cell) => {
      expect(cell.className).not.toContain("w-44");
    });
  });

  it("renders the Persian calendar year in the date fields and keeps the range request Gregorian", async () => {
    await renderPage();

    const faYear = faNumber(PERSIAN_YEAR);
    const fromButton = screen.getByText("از تاریخ").parentElement?.querySelector("button") as HTMLElement;
    const toButton = screen.getByText("تا تاریخ").parentElement?.querySelector("button") as HTMLElement;
    expect(fromButton.textContent).toContain(faYear);
    expect(toButton.textContent).toContain(faYear);
    expect(fromButton.textContent).not.toContain("۷۸۴");

    const params = lastNotificationQuery(calls);
    expect(params.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.get("to")).toBe(todayInTehran());
    expect(params.get("page_size")).toBe("100");
  });

  it("keeps the picked date, the rendered label and the request in sync", async () => {
    await renderPage();
    const initialFrom = lastNotificationQuery(calls).get("from");

    const fromButton = screen.getByText("از تاریخ").parentElement?.querySelector("button") as HTMLElement;
    fireEvent.click(fromButton);

    const dayCells = await waitFor(() => {
      const cells = calendarDayCells();
      expect(cells.length).toBeGreaterThan(0);
      return cells;
    });
    const fifteenth = dayCells.find((cell) => (cell.textContent || "").trim() === "۱۵");
    expect(fifteenth).toBeTruthy();
    fireEvent.click(fifteenth as HTMLButtonElement);

    await waitFor(() => expect(lastNotificationQuery(calls).get("from")).not.toBe(initialFrom));

    const appliedFrom = lastNotificationQuery(calls).get("from") as string;
    expect(appliedFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(appliedFrom.startsWith("2648")).toBe(false);

    // What the request sends, what the page shows, and the Jalali calendar must agree.
    expect(Number(appliedFrom.slice(0, 4))).toBeGreaterThan(2000);
    expect(toJalaliISO(appliedFrom).endsWith("-15")).toBe(true);
    expect(fromButton.textContent?.trim().startsWith("۱۵ ")).toBe(true);
    expect(fromButton.textContent).toContain(faNumber(PERSIAN_YEAR));
  });

  it("ignores a Jalali-shaped date in the address instead of rendering a broken year", async () => {
    window.history.replaceState({}, "", "/app/activity/?from=1405-07-04&to=1405-08-04");
    await renderPage();

    const fromButton = screen.getByText("از تاریخ").parentElement?.querySelector("button") as HTMLElement;
    const toButton = screen.getByText("تا تاریخ").parentElement?.querySelector("button") as HTMLElement;
    expect(fromButton.textContent).not.toContain("۷۸۴");
    expect(fromButton.textContent).toContain(faNumber(PERSIAN_YEAR));
    expect(toButton.textContent).toContain(faNumber(PERSIAN_YEAR));

    const params = lastNotificationQuery(calls);
    expect(Number((params.get("from") as string).slice(0, 4))).toBeGreaterThan(2000);
    expect(Number((params.get("to") as string).slice(0, 4))).toBeGreaterThan(2000);
  });

  it("drops the date filters from the request when a date is cleared", async () => {
    await renderPage();

    const fromButton = screen.getByText("از تاریخ").parentElement?.querySelector("button") as HTMLElement;
    fireEvent.click(fromButton);
    const clearButton = await screen.findByRole("button", { name: "پاک کردن" });
    fireEvent.click(clearButton);

    await waitFor(() => expect(lastNotificationQuery(calls).get("from")).toBeNull());
    expect(fromButton.textContent).toContain("انتخاب تاریخ");
  });

  it("blocks an inverted range, explains why, and does not query it", async () => {
    await renderPage();

    const fromButton = screen.getByText("از تاریخ").parentElement?.querySelector("button") as HTMLElement;
    fireEvent.click(fromButton);
    const dayCells = await waitFor(() => {
      const cells = calendarDayCells();
      expect(cells.length).toBeGreaterThan(1);
      return cells;
    });
    const ordered = [...dayCells].sort(
      (left, right) =>
        faToInt((left.textContent || "").trim()) - faToInt((right.textContent || "").trim()),
    );
    const latestDay = ordered[ordered.length - 1];
    fireEvent.click(latestDay);
    await waitFor(() => expect(notificationCalls(calls).length).toBeGreaterThan(1));
    const callsBefore = notificationCalls(calls).length;

    const toButton = screen.getByText("تا تاریخ").parentElement?.querySelector("button") as HTMLElement;
    fireEvent.click(toButton);
    // Step back to the month that already holds the chosen start day, then take day 1
    // of that month so the range is genuinely inverted.
    const previousMonth = (await waitFor(() => {
      const button = document.querySelector('[role="dialog"] button[aria-label="ماه قبل"]');
      expect(button).toBeTruthy();
      return button;
    })) as HTMLButtonElement;
    fireEvent.click(previousMonth);

    const firstDay = (await waitFor(() => {
      const cells = calendarDayCells();
      const found = cells.find((button) => (button.textContent || "").trim() === "۱");
      expect(found).toBeTruthy();
      return found;
    })) as HTMLButtonElement;
    fireEvent.click(firstDay);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("تاریخ شروع نمی‌تواند پس از تاریخ پایان باشد.");
    expect(
      (screen.getByRole("button", { name: "اعمال فیلتر" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(notificationCalls(calls).length).toBe(callsBefore);
  });

  it("persists the applied filters in the page address", async () => {
    await renderPage();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ticket_created" } });
    fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));

    await waitFor(() => expect(window.location.search).toContain("type=ticket_created"));
    expect(lastNotificationQuery(calls).get("type")).toBe("ticket_created");
    expect(window.location.search).toMatch(/from=\d{4}-\d{2}-\d{2}/);
    expect(window.location.search).toMatch(/to=\d{4}-\d{2}-\d{2}/);
  });

  it("swaps the notification filter for the activity filter on the second tab", async () => {
    await renderPage();

    expect(screen.getByText("نوع اعلان")).toBeTruthy();
    expect(screen.getByText("وضعیت خواندن")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "سوابق فعالیت" }));

    await waitFor(() => expect(screen.queryByText("نوع اعلان")).toBeNull());
    expect(screen.getByText("نوع فعالیت")).toBeTruthy();
    expect(screen.queryByText("وضعیت خواندن")).toBeNull();
    await waitFor(() => expect(window.location.search).toContain("tab=activity"));
  });
});
