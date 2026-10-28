// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PropertyLocationMap } from "./PropertyLocationMap";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("property detail location map", () => {
  it("keeps the pin read-only but lets the map be panned with mouse and touch", () => {
    const { container } = render(<PropertyLocationMap latitude={35.7219} longitude={51.3347} />);

    const map = container.querySelector(".leaflet-container") as HTMLElement;
    expect(map).toBeTruthy();
    // Leaflet only adds this class while the drag handler is enabled, so its presence is the
    // difference between a map that pans and one that merely zooms (the reported bug).
    expect(map.className).toContain("leaflet-grab");
    expect(map.className).toContain("leaflet-touch-drag");
    // An inline cursor used to override Leaflet's grab/grabbing cursor.
    expect(map.style.cursor).toBe("");

    expect(screen.getByText("کشیدن نقشه (ماوس یا لمس) برای جابه‌جایی")).toBeTruthy();
    expect(screen.queryByText("فقط نمایش موقعیت ثبت‌شده")).toBeNull();
  });

  it("renders nothing for a property without valid coordinates", () => {
    const { container } = render(<PropertyLocationMap latitude={Number.NaN} longitude={51.3347} />);
    expect(container.querySelector(".leaflet-container")).toBeNull();
  });
});
