import { describe, expect, it } from "vitest";
import { GUIDE_ENTITIES, GUIDE_FLOWS, GUIDE_PAGES, GUIDE_RULES } from "./guideContent";
import { NAVIGATION_GROUPS, PROFILE_ENTRIES, SETTINGS_ENTRIES } from "../../shared/lib/navigation";

const documented = new Set(GUIDE_PAGES.map((row) => row.page));
const navigable = new Set<string>([
  ...NAVIGATION_GROUPS.flatMap((group) => group.items.map((item) => item.page as string)),
  ...SETTINGS_ENTRIES.map((entry) => entry.page as string),
  ...PROFILE_ENTRIES.map((entry) => entry.page as string),
]);

describe("guide content", () => {
  it("documents every page that appears in the sidebar", () => {
    const missing = [...navigable].filter((page) => !documented.has(page as never));
    expect(missing).toEqual([]);
  });

  it("documents pages that are not reachable from the sidebar", () => {
    const extra = [...documented].filter((page) => !navigable.has(page));
    expect(extra).toEqual([]);
  });

  it("keeps a single row per page with owner, flow and acceptance text", () => {
    expect(new Set(GUIDE_PAGES.map((row) => row.page)).size).toBe(GUIDE_PAGES.length);
    for (const row of GUIDE_PAGES) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.owner.length).toBeGreaterThan(0);
      expect(row.acceptance.length).toBeGreaterThan(0);
      expect(row.code.length).toBeGreaterThan(0);
    }
  });

  it("describes at least three flows and the shared rules", () => {
    expect(GUIDE_FLOWS.length).toBeGreaterThanOrEqual(3);
    expect(GUIDE_ENTITIES.length).toBeGreaterThan(0);
    expect(GUIDE_RULES.length).toBeGreaterThan(0);
  });
});
