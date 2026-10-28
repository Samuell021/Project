export type PipelineTransition = {
  to: string;
  label: string;
  action: string;
  endpoint: string;
  method: "POST" | "PATCH";
  payload?: Record<string, unknown>;
  reason_required: boolean;
  requires?: string[];
};

export type PipelineCard = {
  id: number;
  code: string;
  title: string;
  subtitle: string;
  stage: string;
  stage_label: string;
  owner: string;
  due_at: string | null;
  stage_entered_at: string | null;
  days_in_stage: number;
  stalled: boolean;
  record_page: string;
  warnings: string[];
  financials?: Record<string, string | null>;
  transitions: PipelineTransition[];
};

export type PipelineColumn = {
  code: string;
  label: string;
  count: number;
  cards: PipelineCard[];
};

export type PipelineBoard = {
  kind: string;
  requested_kind?: string;
  label: string;
  stages: PipelineColumn[];
  total: number;
  stalled: number;
  stall_threshold_days: number;
  available: { kind: string; label: string }[];
  filters: Record<string, string>;
};

export type PipelineFilters = {
  search: string;
  assignee: string;
  scope: string;
  deal_type: string;
  priority: string;
  view: "team" | "mine";
  unassigned: boolean;
  overdue: boolean;
};

export function boardQuery(filters: PipelineFilters): string {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.assignee) params.set("assignee", filters.assignee);
  if (filters.scope) params.set("scope", filters.scope);
  if (filters.deal_type) params.set("deal_type", filters.deal_type);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.view === "mine") params.set("mine", "1");
  if (filters.unassigned) params.set("unassigned", "1");
  if (filters.overdue) params.set("overdue", "1");
  return params.toString();
}

export function transitionFor(card: PipelineCard, target: string): PipelineTransition | null {
  return card.transitions.find((transition) => transition.to === target) ?? null;
}

export function blockedReason(transition: PipelineTransition | null, targetLabel: string): string {
  if (!transition) return `انتقال به «${targetLabel}» در این مرحله مجاز نیست؛ از صفحه همان رکورد اقدام کنید.`;
  if (transition.requires && transition.requires.length > 0) {
    return "برای این انتقال، مسئول و موعد باید در صفحه رکورد تعیین شود.";
  }
  return "";
}
