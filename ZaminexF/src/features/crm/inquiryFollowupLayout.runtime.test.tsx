// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Inquiries } from "./pages/InquiriesPage";
import { PermissionProvider } from "../../shared/lib/permissions";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const INQUIRY = {
  id: 61,
  code: "INQ-61",
  contact: 5,
  contact_name: "متقاضی آزمون",
  contact_phone: "09121112233",
  description: "خرید آپارتمان",
  lead_status: "ACCEPTED",
  stage: "needs",
  stage_label: "ثبت نیاز",
  status: "ACTIVE",
  assigned_to_name: "مشاور نمونه",
  sales_range_name: "رنج اول",
  stage_responsible: "کارشناس",
  version: 1,
  updated_at: "2026-10-20T10:00:00Z",
  preferences: [],
  due_at: null,
};

const FOLLOWUPS = [
  { id: 71, inquiryId: 61, title: "تماس اول", date: "2026-10-18T09:00:00Z", status: "planned", result: "PENDING" },
];

describe("inquiry follow-up tab layout", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    window.history.replaceState({}, "", "/app/crm/inquiries/");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/crm/api/inquiries/61/matches/")) return jsonResponse([]);
      if (url.includes("/crm/api/inquiries/61/")) return jsonResponse(INQUIRY);
      if (url.includes("/crm/api/inquiries/")) return jsonResponse({ count: 1, next: null, previous: null, results: [INQUIRY] });
      if (url.includes("/followups/api/followups/")) return jsonResponse({ count: 1, next: null, previous: null, results: FOLLOWUPS });
      return jsonResponse({ count: 0, next: null, previous: null, results: [] });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function renderInquiries() {
    return render(
      <PermissionProvider permissions={["inquiry.manage"]}>
        <Inquiries csrfToken="token" navigate={() => undefined} role="admin" currentUserId="1" initialRecordId="61" />
      </PermissionProvider>,
    );
  }

  it("gives the date and the clock their own row instead of overlapping the other fields", async () => {
    renderInquiries();
    fireEvent.click(await screen.findByRole("tab", { name: "پیگیری‌ها" }, { timeout: 8000 }));

    const label = await screen.findByText("زمان پیگیری", {}, { timeout: 8000 });
    // The date + clock pair is the whole width of the form row: a half track was narrower than the
    // pair's own minimum and pushed the clock over the neighbouring field.
    const row = label.closest("div.sm\\:col-span-2") as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.parentElement?.className).toContain("sm:grid-cols-2");

    // The pair itself wraps instead of overflowing when its container is narrow.
    const pair = label.closest("div.flex") as HTMLElement;
    expect(pair.className).toContain("flex-wrap");
    expect(pair.className).toContain("items-end");
    expect(pair.className).not.toContain("grid-cols-[minmax(0,1fr)_7rem]");
    // The date field keeps its own minimum, so the clock is the part that wraps.
    expect((pair.firstElementChild as HTMLElement).className).toContain("min-w-[13rem]");
    expect(pair.lastElementChild?.getAttribute("type")).toBe("hidden");
  });

  it("keeps the completion row's next-action time on its own row as well", async () => {
    renderInquiries();
    fireEvent.click(await screen.findByRole("tab", { name: "پیگیری‌ها" }, { timeout: 8000 }));

    const label = await screen.findByText("زمان اقدام بعدی", {}, { timeout: 8000 });
    const cell = label.closest("div.sm\\:col-span-2") as HTMLElement;
    expect(cell).not.toBeNull();
    // The submit of that row stays inside the same grid, right-aligned under the fields.
    const submit = screen.getByRole("button", { name: "ثبت نتیجه" });
    expect(submit.parentElement?.className).toContain("sm:col-span-2");
    expect(submit.parentElement?.className).toContain("justify-end");
  });
});
