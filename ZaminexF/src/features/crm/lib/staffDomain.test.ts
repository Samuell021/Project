import { describe, expect, it } from "vitest";
import { buildAssignableStaffOptions } from "./staffDomain";

describe("assignable staff options", () => {
  it("keeps one row per account and trims what the server sends", () => {
    const options = buildAssignableStaffOptions([
      { id: 4, full_name: "  مشاور یک ", role: "agent", branch: " دفتر ", profile_image: "" },
      { id: 4, full_name: "مشاور یک", role: "AGENT", branch: "دفتر" },
      { id: 2, full_name: "مدیر رنج", role: "RANGE_MANAGER", branch: "دفتر", profile_image: "/media/p.png" },
    ]);

    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({
      id: 4,
      full_name: "مشاور یک",
      branch: "دفتر",
      profile_image: null,
      is_active: true,
      user: { id: 4, role: "AGENT" },
    });
    expect(options[1].user.role).toBe("RANGE_MANAGER");
    expect(options[1].profile_image).toBe("/media/p.png");
  });

  it("tolerates a missing or malformed payload", () => {
    expect(buildAssignableStaffOptions(undefined)).toEqual([]);
    expect(buildAssignableStaffOptions(null)).toEqual([]);
    expect(buildAssignableStaffOptions({} as never)).toEqual([]);
    expect(buildAssignableStaffOptions([{ id: "" } as never])).toEqual([]);
  });
});
