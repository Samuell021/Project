import { describe, expect, it } from "vitest";
import {
  INQUIRY_STEPS,
  budgetLabel,
  buildViewingCalendar,
  contractFinancialSummary,
  contractMissingItems,
  deriveInquiryStep,
  matchSummary,
  sortMatches,
  stepIndex,
  validateContractTerms,
  type ContractRecord,
  type ContractTermsSchema,
  type InquiryRecord,
  type MatchResult,
} from "./lib/commercialDomain";

const inquiry = (overrides: Partial<InquiryRecord> = {}): InquiryRecord => ({
  id: 1,
  code: "I-1",
  contact: 5,
  contact_name: "متقاضی",
  status: "ACTIVE",
  stage: "needs",
  version: 1,
  ...overrides,
});

const match = (overrides: Partial<MatchResult> = {}): MatchResult => ({
  property_file_id: 1,
  title: "فایل",
  matched: true,
  match_percent: 100,
  reasons: [],
  blockers: [],
  already_introduced: false,
  ...overrides,
});

const schema = (fields: ContractTermsSchema["fields"]): ContractTermsSchema => ({ fields });

describe("inquiry stage derivation", () => {
  it("starts at the registration step without a record", () => {
    expect(deriveInquiryStep(null)).toBe("lead");
    expect(stepIndex("lead")).toBe(0);
    expect(INQUIRY_STEPS).toHaveLength(9);
  });

  it("uses the server stage and maps every step to its index", () => {
    expect(deriveInquiryStep(inquiry({ stage: "reception" }))).toBe("reception");
    expect(deriveInquiryStep(inquiry({ stage: "viewings" }))).toBe("viewings");
    expect(deriveInquiryStep(inquiry({ stage: "negotiation" }))).toBe("negotiation");
    expect(deriveInquiryStep(inquiry({ stage: "contract" }))).toBe("contract");
    expect(stepIndex("matching")).toBe(5);
    expect(stepIndex("contract")).toBe(8);
  });

  it("falls back to deterministic rules when the server stage is unavailable", () => {
    expect(deriveInquiryStep(inquiry({ stage: "" as never, lead_status: "PENDING" }))).toBe("reception");
    expect(deriveInquiryStep(inquiry({ stage: "" as never, lead_status: "ACCEPTED", assigned_to: null }))).toBe("assignment");
    expect(deriveInquiryStep(inquiry({ stage: "" as never, lead_status: "ACCEPTED", acceptance_status: "PENDING", assigned_to: 9 }))).toBe("acceptance");
    expect(deriveInquiryStep(inquiry({ stage: "" as never, lead_status: "ACCEPTED", acceptance_status: "ACCEPTED", assigned_to: 9, needs_confirmed_at: null }))).toBe("needs");
    expect(deriveInquiryStep(inquiry({ stage: "" as never, lead_status: "ACCEPTED", acceptance_status: "ACCEPTED", assigned_to: 9, needs_confirmed_at: "2026-01-01T00:00:00Z" }))).toBe("matching");
  });
});

describe("matching results", () => {
  it("sorts matched listings first and by percent descending", () => {
    const sorted = sortMatches([
      match({ property_file_id: 1, matched: false, match_percent: 90 }),
      match({ property_file_id: 2, matched: true, match_percent: 70 }),
      match({ property_file_id: 3, matched: true, match_percent: 95 }),
    ]);
    expect(sorted.map((item) => item.property_file_id)).toEqual([3, 2, 1]);
  });

  it("explains blockers and failed reasons in Persian", () => {
    expect(matchSummary(match({ matched: false, blockers: ["مبلغ یا ودیعه خارج از بودجه است"] }))).toBe("مبلغ یا ودیعه خارج از بودجه است");
    expect(matchSummary(match({ matched: false, blockers: [], reasons: [{ label: "منطقه", passed: false }] }))).toBe("ناسازگاری در منطقه");
    expect(matchSummary(match())).toBe("همهٔ شرط‌های الزامی و بودجه منطبق است");
  });

  it("summarizes rental and sale budgets separately", () => {
    expect(budgetLabel({ deal_type: 1, max_deposit: 500000, max_monthly_rent: 20000 }, "RENT")).toBe("ودیعه تا ۵۰۰٬۰۰۰ تومان · اجاره تا ۲۰٬۰۰۰ تومان");
    expect(budgetLabel({ deal_type: 1, min_amount: 100000, max_amount: 200000 }, "SALE")).toBe("از ۱۰۰٬۰۰۰ تومان تا ۲۰۰٬۰۰۰ تومان");
  });
});

describe("contract terms validation for all deal families", () => {
  const cases: Array<{ family: string; fields: ContractTermsSchema["fields"]; valid: Record<string, unknown>; invalid: Record<string, unknown> }> = [
    {
      family: "SALE",
      fields: [{ key: "sale_price", label: "ثمن معامله", type: "integer", unit: "تومان", required: true }],
      valid: { sale_price: "1200000000" },
      invalid: { sale_price: "abc" },
    },
    {
      family: "RENT",
      fields: [
        { key: "deposit", label: "ودیعه", type: "integer", unit: "تومان", required: true },
        { key: "monthly_rent", label: "اجاره ماهانه", type: "integer", unit: "تومان", required: true },
      ],
      valid: { deposit: "500000000", monthly_rent: "15000000" },
      invalid: { deposit: "500000000", monthly_rent: "" },
    },
    {
      family: "FULL_MORTGAGE",
      fields: [{ key: "deposit", label: "ودیعه", type: "integer", unit: "تومان", required: true }],
      valid: { deposit: "900000000" },
      invalid: {},
    },
    {
      family: "PRE_SALE",
      fields: [
        { key: "down_payment", label: "پیش‌پرداخت", type: "integer", unit: "تومان", required: true },
        { key: "installments", label: "شرح اقساط", type: "text", unit: "", required: true },
      ],
      valid: { down_payment: "400000000", installments: "۱۲ قسط ماهانه" },
      invalid: { down_payment: "400000000" },
    },
    {
      family: "PARTNERSHIP",
      fields: [
        { key: "owner_share", label: "سهم مالک", type: "decimal", unit: "درصد", required: true },
        { key: "contribution", label: "آورده", type: "text", unit: "", required: false },
      ],
      valid: { owner_share: "40" },
      invalid: { owner_share: "120" },
    },
    {
      family: "EXCHANGE",
      fields: [
        { key: "exchange_asset", label: "عوض معامله", type: "text", unit: "", required: true },
        { key: "cash_difference", label: "مابه‌التفاوت", type: "integer", unit: "تومان", required: false },
      ],
      valid: { exchange_asset: "آپارتمان در ونک", cash_difference: "200000000" },
      invalid: { exchange_asset: "آپارتمان در ونک", cash_difference: "1.5" },
    },
  ];

  it.each(cases)("$family accepts a complete term set", ({ fields, valid }) => {
    const result = validateContractTerms(schema(fields), valid);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.missing).toEqual([]);
  });

  it.each(cases)("$family rejects an invalid term set", ({ fields, invalid }) => {
    const result = validateContractTerms(schema(fields), invalid);
    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors).length).toBeGreaterThan(0);
  });

  it("rejects unknown keys and empty schemas", () => {
    expect(validateContractTerms(schema([{ key: "sale_price", label: "ثمن", type: "integer", required: true }]), { sale_price: "1", note: "x" }).errors.note).toBeTruthy();
    expect(validateContractTerms(null, {}).valid).toBe(false);
  });
});

describe("contract review helpers", () => {
  const contract: ContractRecord = {
    id: 1,
    deal: 2,
    contract_number: "C-1",
    status: "SIGNING",
    version: 3,
    terms_snapshot: { sale_price: "1000000", installments: "نقدی" },
    parties: [
      { id: 1, contact: 10, contact_name: "خریدار", party_role: "BUYER", signature_status: "SIGNED" },
      { id: 2, contact: 11, contact_name: "فروشنده", party_role: "SELLER", signature_status: "PENDING" },
    ],
  };

  it("builds the financial summary from the terms snapshot", () => {
    const summary = contractFinancialSummary(contract);
    expect(summary).toContainEqual({ label: "ثمن معامله", value: "۱٬۰۰۰٬۰۰۰ تومان" });
    expect(summary).toContainEqual({ label: "شرح اقساط", value: "نقدی" });
  });

  it("lists missing terms, parties and signatures before finalization", () => {
    const missing = contractMissingItems(contract, schema([{ key: "sale_price", label: "ثمن معامله", type: "integer", required: true }]));
    expect(missing.some((item) => item.includes("فروشنده"))).toBe(true);
    const withoutParties = contractMissingItems({ ...contract, parties: [] });
    expect(withoutParties).toContain("طرفین قرارداد ثبت نشده‌اند.");
  });
});

describe("viewing calendar", () => {
  it("places the first day on the correct weekday column", () => {
    const cells = buildViewingCalendar(1405, 1);
    expect(cells.length).toBeGreaterThanOrEqual(31);
    expect(cells.filter((cell) => cell.day !== null)).toHaveLength(31);
    expect(cells[cells.findIndex((cell) => cell.day === 1)].isoDate).toBe("1405-01-01");
  });
});
