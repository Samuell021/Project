import { describe, expect, it } from "vitest";
import { boardQuery, blockedReason, transitionFor, type PipelineCard, type PipelineTransition } from "./pipelineDomain";

const transition: PipelineTransition = {
  to: "AGREED",
  label: "توافق",
  action: "agree",
  endpoint: "/crm/api/deals/1/agree/",
  method: "POST",
  reason_required: false,
};

const card = (overrides: Partial<PipelineCard> = {}): PipelineCard => ({
  id: 1,
  code: "D-1",
  title: "مذاکره",
  subtitle: "فایل ۱",
  stage: "NEGOTIATION",
  stage_label: "مذاکره",
  owner: "کارشناس",
  due_at: null,
  stage_entered_at: null,
  days_in_stage: 3,
  stalled: false,
  record_page: "crm-deals",
  warnings: [],
  transitions: [transition],
  ...overrides,
});

describe("pipeline board query", () => {
  it("only serialises active filters", () => {
    expect(
      boardQuery({
        search: "  ",
        assignee: "",
        scope: "",
        deal_type: "",
        priority: "",
        view: "all",
        unassigned: false,
        overdue: false,
      }),
    ).toBe("");
  });

  it("trims search and keeps flags", () => {
    const query = boardQuery({
      search: "  فایل ۱۲ ",
      assignee: "4",
      scope: "2",
      deal_type: "3",
      priority: "HIGH",
      view: "mine",
      unassigned: true,
      overdue: true,
    });
    const params = new URLSearchParams(query);
    expect(params.get("search")).toBe("فایل ۱۲");
    expect(params.get("assignee")).toBe("4");
    expect(params.get("scope")).toBe("2");
    expect(params.get("deal_type")).toBe("3");
    expect(params.get("priority")).toBe("HIGH");
    expect(params.get("mine")).toBe("1");
    expect(params.get("unassigned")).toBe("1");
    expect(params.get("overdue")).toBe("1");
  });
});

describe("pipeline transitions", () => {
  it("finds a transition by target stage", () => {
    expect(transitionFor(card(), "AGREED")?.action).toBe("agree");
    expect(transitionFor(card(), "LOST")).toBeNull();
  });

  it("explains a missing transition with the stage name", () => {
    expect(blockedReason(null, "توافق")).toContain("توافق");
  });

  it("asks for owner and due date when the transition requires them", () => {
    expect(blockedReason({ ...transition, requires: ["assignee", "due_at"] }, "توافق")).toContain("مسئول");
  });

  it("returns no message for an allowed transition", () => {
    expect(blockedReason(transition, "توافق")).toBe("");
  });
});
