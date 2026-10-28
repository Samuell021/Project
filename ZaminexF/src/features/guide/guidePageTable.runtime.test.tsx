// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import GuidePage from "./GuidePage";
import { GUIDE_PAGES } from "./guideContent";

function renderGuide(role: "admin" | "consultant") {
  window.history.replaceState({}, "", "/app/guide/?tab=pages");
  const navigate = vi.fn();
  render(<GuidePage role={role} navigate={navigate} />);
  return { navigate };
}

function nameCells(): HTMLTableCellElement[] {
  const table = screen.getByRole("table", { name: "راهنمای صفحه‌به‌صفحه" });
  return Array.from(table.querySelectorAll("tbody tr")).map((row) => row.children[0] as HTMLTableCellElement);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("guide page table", () => {
  it("starts from the exact five columns of the page-by-page guide", () => {
    const table = (renderGuide("admin"), screen.getByRole("table", { name: "راهنمای صفحه‌به‌صفحه" }));
    const headers = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers).toEqual(["صفحه", "مالک", "جریان", "معیار پذیرش", "مسیر کد"]);
    expect(table.querySelectorAll("tbody tr")).toHaveLength(GUIDE_PAGES.length);
    for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
      expect(row.children).toHaveLength(5);
    }
  });

  it("anchors every page name to the right edge of the column", () => {
    renderGuide("admin");
    const cells = nameCells();
    expect(cells).toHaveLength(GUIDE_PAGES.length);
    for (const cell of cells) {
      const classes = cell.className.split(/\s+/);
      // The cell declares the alignment itself instead of relying on an inherited default…
      expect(classes).toContain("text-right");
      expect(classes).not.toContain("text-center");
      expect(classes).not.toContain("text-left");
      // …and the name keeps one line, so no row can break into a second, shifted line.
      expect(classes).toContain("whitespace-nowrap");
    }
    // Every name cell carries the very same alignment, so the column has one shared text edge.
    const shapes = new Set(cells.map((cell) => cell.className.split(/\s+/).sort().join(" ")));
    expect(shapes.size).toBe(1);
  });

  it("right-aligns the name link itself, so the user-agent centring never applies", () => {
    const { navigate } = renderGuide("admin");
    const cells = nameCells();
    cells.forEach((cell, index) => {
      const button = within(cell).getByRole("button");
      expect(button.textContent).toBe(GUIDE_PAGES[index].label);
      const classes = button.className.split(/\s+/);
      expect(classes).toContain("text-right");
      expect(classes).not.toContain("text-center");
      expect(classes).not.toContain("block");
    });

    fireEvent.click(within(cells[0]).getByRole("button"));
    expect(navigate).toHaveBeenCalledWith(GUIDE_PAGES[0].page);
  });

  it("keeps the column header on the same right edge as its cells", () => {
    renderGuide("admin");
    const table = screen.getByRole("table", { name: "راهنمای صفحه‌به‌صفحه" });
    const header = table.querySelector("thead th") as HTMLTableCellElement;
    expect(header.className.split(/\s+/)).toContain("text-right");
    expect(header.className.split(/\s+/)).toContain("whitespace-nowrap");
  });

  it("gives the consultant panel the same aligned column", () => {
    renderGuide("consultant");
    const cells = nameCells();
    expect(cells).toHaveLength(GUIDE_PAGES.length);
    for (const cell of cells) {
      expect(cell.className.split(/\s+/)).toEqual(
        expect.arrayContaining(["p-3", "text-right", "whitespace-nowrap"]),
      );
      expect(within(cell).getByRole("button").className.split(/\s+/)).toContain("text-right");
    }
  });

  it("closes the tab list with the page-by-page tab selected from the address", () => {
    renderGuide("admin");
    expect(screen.getByRole("tab", { name: "راهنمای صفحه‌به‌صفحه" }).getAttribute("aria-selected")).toBe("true");
    expect(window.location.search).toContain("tab=pages");
  });
});
