// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Finance } from "./pages/FinancePage";
import { PermissionProvider } from "../../shared/lib/permissions";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const OVERVIEW = {
  contracts: [
    {
      id: 9,
      contract_number: "CT-9",
      status: "FINALIZED",
      finalized_at: "2026-10-01T10:00:00Z",
      deal_type: "فروش",
      title: "آپارتمان جردن",
      deal_value: "1000000000",
      claims_count: 1,
      claimed: "20000000",
      received: "5000000",
      remaining: "15000000",
      shares_total: "0",
      shares_paid: "0",
    },
  ],
  totals: { claimed: "20000000", received: "5000000", shares_paid: "0", outstanding: "15000000" },
  claim_count: 1,
  payment_count: 1,
};

const SHARE = {
  id: 21,
  beneficiary_type: "USER",
  beneficiary_user: 3,
  beneficiary_name: "مشاور نمونه",
  share_percent: "60",
  amount: "12000000",
  paid_amount: "0",
  remaining_amount: "12000000",
  status: "APPROVED",
  status_label: "تأییدشده",
};

const CLAIM = {
  id: 31,
  status: "APPROVED",
  status_label: "تأییدشده",
  calculated_amount: "20000000",
  adjustment_amount: "0",
  final_amount: "20000000",
  received_amount: "5000000",
  remaining_amount: "15000000",
  shares_total: "12000000",
  due_at: null,
  policy_version: null,
  calculation_snapshot: {},
  debtor_contact: 5,
  shares: [SHARE],
  payments: [],
};

const PAYMENT = {
  id: 41,
  direction: "IN",
  amount: "5000000",
  paid_at: "2026-10-20T12:00:00Z",
  method: "کارت‌به‌کارت",
  reference_number: "",
  status: "CONFIRMED",
  status_label: "تأییدشده",
  reversal_of: null,
  allocations: [{ id: 51, commission: 31, commission_share: null, amount: "5000000" }],
};

const DETAIL = {
  contract: {
    id: 9,
    contract_number: "CT-9",
    status: "FINALIZED",
    deal_type: "فروش",
    title: "آپارتمان جردن",
    deal_value: "1000000000",
  },
  totals: { claimed: "20000000", received: "5000000", shares_paid: "0", outstanding: "15000000" },
  claims: [CLAIM],
  payments: [PAYMENT],
  policies: [],
  debtor_options: [{ contact: 5, role: "SELLER", label: "مالک آزمون" }],
  can_manage: true,
  can_policy: false,
};

describe("finance claim receipt form and payment reversal", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    window.history.replaceState({}, "", "/app/crm/finance/?contract=9");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/crm/api/finance/overview/")) return jsonResponse(OVERVIEW);
      if (url.includes("/crm/api/finance/contracts/9/")) return jsonResponse(DETAIL);
      return jsonResponse({ count: 0, next: null, previous: null, results: [] });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function renderFinance() {
    return render(
      <PermissionProvider permissions={["finance.manage"]}>
        <Finance csrfToken="token" />
      </PermissionProvider>,
    );
  }

  it("lays the partial-receipt fields out in two aligned columns instead of four cramped ones", async () => {
    const view = renderFinance();
    const title = await screen.findByText("ثبت دریافت و تخصیص جزئی", {}, { timeout: 8000 });
    const block = title.parentElement as HTMLElement;
    const grid = block.querySelector("div.grid") as HTMLElement;

    // A quarter-width track is narrower than the Jalali field's own 13rem minimum, which used to
    // push the box over the neighbouring fields.
    expect(grid.className).toContain("sm:grid-cols-2");
    expect(grid.className).not.toContain("sm:grid-cols-4");
    expect(grid.className).toContain("gap-3");

    for (const label of ["مبلغ دریافت", "روش", "تاریخ دریافت (شمسی)"]) {
      const field = within(block).getByText(label).parentElement as HTMLElement;
      // Every field is a direct grid cell, so the three controls share one label/control rhythm.
      expect(field.parentElement).toBe(grid);
    }

    // The submit button shares the last row and is bottom-aligned with the date field.
    const submit = within(block).getByRole("button", { name: "ثبت دریافت" });
    const buttonCell = submit.parentElement as HTMLElement;
    expect(buttonCell.parentElement).toBe(grid);
    expect(buttonCell.className).toContain("items-end");
  });

  it("keeps the reversal icon and its title on one line in the payments tab", async () => {
    renderFinance();
    await screen.findByText("ثبت دریافت و تخصیص جزئی", {}, { timeout: 8000 });
    fireEvent.click(screen.getByRole("tab", { name: "وجوه و تخصیص" }));

    const reverse = await screen.findByRole("button", { name: "برگشت" });
    // Tailwind preflight renders `svg` as block; the shared button now owns an inline-flex row, so
    // the icon can never be pushed above its label.
    expect(reverse.className).toContain("inline-flex");
    expect(reverse.className).toContain("items-center");
    expect(reverse.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(reverse.textContent?.trim()).toBe("برگشت");

    // And clicking it still posts the reversal for that payment.
    fireEvent.click(reverse);
    const called = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => String(call[0]));
    expect(called.some((url) => url.includes("/crm/api/payments/41/reverse/"))).toBe(true);
  });
});
