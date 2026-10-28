// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Inquiries } from "./pages/InquiriesPage";
import { SearchBar } from "./components/CrmUIKit";
import { PermissionProvider } from "../../shared/lib/permissions";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const INQUIRY = {
  id: 61,
  code: "INQ-61",
  contact: 5,
  contact_name: "متقاضی آزمون",
  description: "خرید آپارتمان",
  stage: "needs",
  stage_label: "ثبت نیاز",
  status: "ACTIVE",
  version: 1,
  preferences: [],
};

describe("inquiry toolbar alignment", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    window.history.replaceState({}, "", "/app/crm/inquiries/");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/crm/api/inquiries/")) return jsonResponse({ count: 1, next: null, previous: null, results: [INQUIRY] });
      return jsonResponse({ count: 0, next: null, previous: null, results: [] });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("keeps the search field on the same baseline as the create button", async () => {
    render(
      <PermissionProvider permissions={["inquiry.manage"]}>
        <Inquiries csrfToken="token" navigate={() => undefined} role="admin" currentUserId="1" />
      </PermissionProvider>,
    );

    const button = await screen.findByRole("button", { name: "ثبت درخواست متقاضی" });
    const toolbar = button.parentElement as HTMLElement;
    expect(toolbar.className).toContain("items-center");

    // The search field is a sibling in that row and no longer carries its own bottom margin, which
    // used to lift it out of line with the button.
    const field = within(toolbar).getByRole("searchbox");
    const fieldBox = field.parentElement as HTMLElement;
    expect(fieldBox.parentElement).toBe(toolbar);
    expect(fieldBox.className).not.toContain("mb-4");

    // And the button keeps its icon and title on one line.
    expect(button.className).toContain("inline-flex");
    expect(button.className).toContain("items-center");
    expect(button.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(button.textContent?.trim()).toBe("ثبت درخواست متقاضی");
  });

  it("still spaces a stacked search field away from what follows it", () => {
    render(<SearchBar value="" onChange={() => undefined} />);
    expect((screen.getByRole("searchbox").parentElement as HTMLElement).className).toContain("mb-4");

    cleanup();
    render(<SearchBar value="" onChange={() => undefined} flush />);
    expect((screen.getByRole("searchbox").parentElement as HTMLElement).className).not.toContain("mb-4");
  });
});
