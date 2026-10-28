// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { InquiryRegisterPage } from "./pages/InquiryRegisterPage";
import { PermissionProvider } from "../../shared/lib/permissions";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const CONTACTS = [
  { id: 5, full_name: "متقاضی آزمون", national_code: "0012345678", phones: [{ id: 1, phone: "09121112233", is_primary: true }] },
  // The same person stored twice: it must be listed once.
  { id: 6, full_name: "متقاضی آزمون", national_code: "0012345678", phones: [{ id: 2, phone: "09121112233", is_primary: true }] },
  { id: 7, full_name: "متقاضی دیگر", national_code: "0087654321", phones: [{ id: 3, phone: "09354445566", is_primary: true }] },
];

describe("inquiry registration applicant picker", () => {
  const originalFetch = globalThis.fetch;
  let posted: Array<Record<string, unknown>>;

  beforeEach(() => {
    posted = [];
    window.localStorage.clear();
    window.history.replaceState({}, "", "/app/crm/inquiry-register/");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (String(init?.method || "GET").toUpperCase() === "POST" && url.includes("/crm/api/inquiries/")) {
        posted.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
        return jsonResponse({ id: 91, code: "INQ-91", contact_name: "متقاضی آزمون", stage: "lead", version: 1 }, 201);
      }
      if (url.includes("/crm/api/contacts/")) return jsonResponse({ count: CONTACTS.length, next: null, previous: null, results: CONTACTS });
      return jsonResponse({ count: 0, next: null, previous: null, results: [] });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function renderPage() {
    return render(
      <PermissionProvider permissions={null}>
        <InquiryRegisterPage csrfToken="token" navigate={() => undefined} role="admin" currentUserId="1" />
      </PermissionProvider>,
    );
  }

  it("offers the applicant as a searchable picker with each person listed once", async () => {
    renderPage();

    // The create step no longer uses a plain select: it is the same combobox as the rest of the panel.
    const trigger = await screen.findByRole("button", { name: /انتخاب متقاضی از اشخاص CRM/ }, { timeout: 8000 });
    fireEvent.click(trigger);

    const search = await screen.findByLabelText("جستجو در اشخاص");
    const options = () => within(document.querySelector('[role="listbox"]') as HTMLElement).getAllByRole("option");
    await waitFor(() => expect(options()).toHaveLength(2), { timeout: 8000 });
    // The indistinguishable duplicate of the same person is collapsed, not repeated.
    expect(within(document.querySelector('[role="listbox"]') as HTMLElement).getAllByText("متقاضی آزمون")).toHaveLength(1);

    fireEvent.change(search, { target: { value: "0935" } });
    expect(options()).toHaveLength(1);
    expect(options()[0].textContent).toContain("متقاضی دیگر");
  });

  it("submits the chosen applicant id to the inquiries endpoint", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /انتخاب متقاضی از اشخاص CRM/ }, { timeout: 8000 }));
    const option = await screen.findByRole("option", { name: /متقاضی دیگر/ }, { timeout: 8000 });
    fireEvent.click(option);

    // The picked person is echoed in the trigger itself.
    expect(screen.getByRole("button", { name: /متقاضی دیگر/ })).toBeTruthy();

    const submit = screen.getByRole("button", { name: "ثبت درخواست و ادامه" });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(posted).toHaveLength(1), { timeout: 8000 });
    expect(posted[0].contact).toBe(7);
  });
});
