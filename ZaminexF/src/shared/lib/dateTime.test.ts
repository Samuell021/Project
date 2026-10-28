import { describe, expect, it } from "vitest";
import { localDateTimeParts, localDateTimeToIso } from "./dateTime";

describe("CRM date-time conversion", () => {
  it("keeps date and hour aligned with the browser's local time", () => {
    const source = "2026-10-22T10:45:00Z";
    const parsed = new Date(source);
    const parts = localDateTimeParts(source);
    const pad = (part: number) => String(part).padStart(2, "0");

    expect(parts).toEqual({
      date: `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`,
      time: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`,
    });
    expect(localDateTimeToIso(parts.date, parts.time)).toBe(
      new Date(`${parts.date}T${parts.time}:00`).toISOString(),
    );
  });

  it("uses a practical local time for an existing date-only value", () => {
    expect(localDateTimeParts("2026-10-22")).toEqual({
      date: "2026-10-22",
      time: "09:00",
    });
  });

  it("rejects empty or malformed date-time parts", () => {
    expect(localDateTimeToIso("", "09:00")).toBe("");
    expect(localDateTimeToIso("2026-10-22", "not-a-time")).toBe("");
    expect(localDateTimeParts("not-a-date").date).toBe("");
  });
});
