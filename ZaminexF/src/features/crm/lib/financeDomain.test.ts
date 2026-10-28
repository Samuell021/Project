import { describe, expect, it } from "vitest";
import {
  claimStateLabel,
  faDigits,
  moneyOrUnknown,
  numberOrUnknown,
  paymentTone,
  policySignature,
  type FinanceClaim,
  type FinancePayment,
} from "./financeDomain";

const claim = (overrides: Partial<FinanceClaim> = {}): FinanceClaim => ({
  id: 1,
  debtor_contact: 9,
  policy_version: 2,
  calculation_snapshot: {},
  calculated_amount: "1000",
  adjustment_amount: "0",
  final_amount: "1000",
  adjustment_reason: "",
  due_at: null,
  status: "APPROVED",
  status_label: "تأیید شده",
  received: "400",
  remaining: "600",
  shares: [],
  ...overrides,
});

const payment = (overrides: Partial<FinancePayment> = {}): FinancePayment => ({
  id: 1,
  direction: "IN",
  amount: "400",
  paid_at: "2026-10-01T10:00:00+03:30",
  method: "کارت به کارت",
  reference_number: "123",
  status: "CONFIRMED",
  status_label: "تأیید شده",
  reversal_of: null,
  reversed_by: null,
  contact: 9,
  user: null,
  recorded_by: "مالی",
  allocations: [],
  ...overrides,
});

describe("finance formatting", () => {
  it("converts latin digits for display", () => {
    expect(faDigits("1404/07/01")).toBe("۱۴۰۴/۰۷/۰۱");
  });

  it("shows unknown for empty or invalid amounts", () => {
    expect(moneyOrUnknown("")).toBe("نامشخص");
    expect(moneyOrUnknown("abc")).toBe("نامشخص");
    expect(moneyOrUnknown("2500")).toBe("۲٬۵۰۰ تومان");
  });

  it("shows unknown for missing identifiers", () => {
    expect(numberOrUnknown(undefined)).toBe("نامشخص");
    expect(numberOrUnknown("12")).toBe("۱۲");
  });
});

describe("finance state labels", () => {
  it("names partial and full settlement explicitly", () => {
    expect(claimStateLabel(claim({ status: "PAID" }))).toBe("تسویه‌شده");
    expect(claimStateLabel(claim({ status: "PARTIALLY_PAID" }))).toBe("وصول جزئی");
    expect(claimStateLabel(claim({ status: "APPROVED" }))).toContain("بدون وصول");
  });

  it("keeps the server label for pending claims", () => {
    expect(claimStateLabel(claim({ status: "PENDING", status_label: "در انتظار تأیید" }))).toBe("در انتظار تأیید");
  });

  it("marks reversed documents as negative regardless of direction", () => {
    expect(paymentTone(payment({ status: "REVERSED", direction: "IN" }))).toBe("negative");
    expect(paymentTone(payment({ direction: "IN" }))).toBe("positive");
    expect(paymentTone(payment({ direction: "OUT" }))).toBe("neutral");
  });
});

describe("commission policy signature", () => {
  it("renders percent policies", () => {
    expect(policySignature({ percent: "2.5" }, "PERCENT")).toBe("۲.۵٪");
  });

  it("renders flat policies as amounts", () => {
    expect(policySignature({ flat_amount: "900000" }, "FLAT")).toBe("۹۰۰٬۰۰۰ تومان");
  });
});
