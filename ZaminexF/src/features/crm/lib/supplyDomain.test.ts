import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEAD_SOURCE,
  LEAD_SOURCE_OPTIONS,
  isLeadSource,
  normalizeLeadSource,
} from "./supplyDomain";

// Kept in the same order as `apps.crm.models.LeadSource`; the backend test
// `test_lead_source_options_match_the_model_choices` compares the two lists.
const SERVER_CHOICES: Array<[string, string]> = [
  ["OWNER_REFERRAL", "مراجعه یا تماس مالک"],
  ["ADVISOR_NETWORK", "شبکه ارتباطی مشاور"],
  ["PORTAL", "پرتال و آگهی"],
  ["REFERRAL", "معرفی"],
  ["WALK_IN", "حضوری"],
  ["OTHER", "سایر"],
];

describe("lead source options", () => {
  it("offers exactly the choices the server accepts, with the server's labels", () => {
    expect(LEAD_SOURCE_OPTIONS.map((option) => [option.value, option.label])).toEqual(SERVER_CHOICES);
  });

  it("has a default that is itself an accepted choice", () => {
    expect(isLeadSource(DEFAULT_LEAD_SOURCE)).toBe(true);
    expect(LEAD_SOURCE_OPTIONS.some((option) => option.value === DEFAULT_LEAD_SOURCE)).toBe(true);
  });

  it("replaces codes the server rejects instead of submitting them", () => {
    // These were offered by an older build and stored in user drafts; the server answers 400.
    for (const legacy of ["DIRECT_CALL", "IN_PERSON", "WEBSITE", "CAMPAIGN", "", " ", null, undefined, 42]) {
      expect(normalizeLeadSource(legacy)).toBe(DEFAULT_LEAD_SOURCE);
    }
    expect(normalizeLeadSource(" referral ")).toBe("REFERRAL");
    expect(normalizeLeadSource("PORTAL")).toBe("PORTAL");
  });
});
