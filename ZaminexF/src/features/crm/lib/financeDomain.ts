export type FinanceTotals = {
  claimed: string;
  received: string;
  shares_paid?: string;
  outstanding: string;
};

export type FinanceContractRow = {
  id: number;
  contract_number: string;
  status: string;
  finalized_at: string | null;
  deal_type: string;
  title: string;
  deal_value: string;
  claims_count: number;
  claimed: string;
  received: string;
  remaining: string;
  shares_total: string;
  shares_paid: string;
};

export type FinanceOverview = {
  contracts: FinanceContractRow[];
  totals: FinanceTotals;
  claim_count: number;
  payment_count: number;
};

export type FinanceShare = {
  id: number;
  beneficiary_type: "USER" | "COMPANY";
  beneficiary_user: number | null;
  beneficiary_name: string;
  share_percent: string | null;
  amount: string;
  paid_amount: string;
  remaining_amount: string;
  status: string;
  status_label: string;
};

export type FinanceAllocation = {
  id: number;
  commission: number | null;
  commission_share: number | null;
  amount: string;
};

export type FinancePayment = {
  id: number;
  direction: "IN" | "OUT";
  amount: string;
  paid_at: string | null;
  method: string;
  reference_number: string;
  status: string;
  status_label: string;
  reversal_of: number | null;
  allocations: FinanceAllocation[];
};

export type FinanceClaim = {
  id: number;
  status: string;
  status_label: string;
  calculated_amount: string;
  adjustment_amount: string;
  final_amount: string;
  received_amount: string;
  remaining_amount: string;
  shares_total: string;
  due_at: string | null;
  policy_version: number | null;
  calculation_snapshot: Record<string, unknown>;
  debtor_contact: number | null;
  shares: FinanceShare[];
  payments: FinancePayment[];
};

export type FinanceContractDetail = {
  contract: {
    id: number;
    contract_number: string;
    status: string;
    deal_value: string;
    deal_type: string;
    title: string;
    terms_snapshot: Record<string, unknown>;
  };
  claims: FinanceClaim[];
  payments: FinancePayment[];
  policies: {
    id: number;
    name: string;
    version_number: number;
    status: string;
    calculation_method: string;
    parameters: Record<string, unknown>;
  }[];
  debtor_options: { contact: number; role: string; label: string }[];
  totals: { claimed: string; received: string };
  can_manage: boolean;
  can_policy: boolean;
};

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function faDigits(value: string): string {
  return value.replace(/[0-9]/g, (digit) => FA_DIGITS[Number(digit)]);
}

export function moneyOrUnknown(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "نامشخص";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "نامشخص";
  return `${amount.toLocaleString("fa-IR")} تومان`;
}

export function numberOrUnknown(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "نامشخص";
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString("fa-IR") : "نامشخص";
}

export function claimStateLabel(claim: FinanceClaim): string {
  if (claim.status === "PAID") return "تسویه‌شده";
  if (claim.status === "PARTIALLY_PAID") return "وصول جزئی";
  if (claim.status === "APPROVED") return "تأییدشده، بدون وصول";
  return claim.status_label;
}

export function paymentTone(payment: FinancePayment): "positive" | "neutral" | "negative" {
  if (payment.status === "REVERSED") return "negative";
  return payment.direction === "IN" ? "positive" : "neutral";
}

export function policySignature(parameters: Record<string, unknown>, method: string): string {
  if (method === "PERCENT") return `${faDigits(String(parameters.percent ?? "۰"))}٪`;
  return moneyOrUnknown(parameters.flat_amount as string | undefined);
}
