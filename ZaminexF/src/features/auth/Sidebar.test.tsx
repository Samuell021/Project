import React from "react";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { navigationStorageKey } from "../../shared/lib/navigation";

let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM("<html><body></body></html>", { url: "https://crm.example.test" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
});

afterEach(() => {
  cleanup();
  dom.window.close();
  vi.unstubAllGlobals();
});

const props = {
  role: "admin" as const,
  page: "crm-inbox" as const,
  navigate: vi.fn(),
  collapsed: false,
  setCollapsed: vi.fn(),
  userName: "کاربر آزمون",
  userId: "12",
  onLogout: vi.fn(),
};

describe("sidebar group interactions", () => {
  it("starts closed and persists a group only after explicit expansion", () => {
    const view = render(<Sidebar {...props} />);
    const toggle = view.getByRole("button", { name: "فضای کار" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(view.queryByRole("button", { name: "کارتابل پذیرش" })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(view.getByRole("button", { name: "کارتابل پذیرش" }).getAttribute("aria-current")).toBe("page");
    expect(window.localStorage.getItem(navigationStorageKey("12"))).toBe('["workspace"]');
    fireEvent.click(toggle);
    expect(window.localStorage.getItem(navigationStorageKey("12"))).toBe("[]");
  });

  it("restores saved groups without opening another user's groups", () => {
    window.localStorage.setItem(navigationStorageKey("12"), '["workspace"]');
    const view = render(<Sidebar {...props} />);
    expect(view.getByRole("button", { name: "فضای کار" }).getAttribute("aria-expanded")).toBe("true");
    view.rerender(<Sidebar {...props} userId="21" />);
    expect(view.getByRole("button", { name: "فضای کار" }).getAttribute("aria-expanded")).toBe("false");
    expect(window.localStorage.getItem(navigationStorageKey("12"))).toBe('["workspace"]');
    fireEvent.click(view.getByRole("button", { name: "قرارداد و مالی" }));
    expect(window.localStorage.getItem(navigationStorageKey("21"))).toBe('["finance"]');
    view.rerender(<Sidebar {...props} />);
    expect(view.getByRole("button", { name: "فضای کار" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("navigates to the registry destination and retains the active state", () => {
    const navigate = vi.fn();
    const view = render(<Sidebar {...props} navigate={navigate} />);
    fireEvent.click(view.getByRole("button", { name: "فضای کار" }));
    fireEvent.click(view.getByRole("button", { name: "کارتابل پذیرش" }));
    expect(navigate).toHaveBeenCalledWith("crm-inbox");
  });

  it("keeps the settings section reachable from the footer button", () => {
    const navigate = vi.fn();
    const view = render(<Sidebar {...props} navigate={navigate} />);
    fireEvent.click(view.getByRole("button", { name: "تنظیمات" }));
    expect(navigate).toHaveBeenCalledWith("settings-workspace");
    view.rerender(<Sidebar {...props} page="settings-ranges" navigate={navigate} />);
    expect(view.getByRole("button", { name: "تنظیمات" }).className).toContain("bg-white/10");
  });

  it("expands the sidebar when a collapsed group is selected", () => {
    const setCollapsed = vi.fn();
    const view = render(<Sidebar {...props} collapsed setCollapsed={setCollapsed} />);
    fireEvent.click(view.getByRole("button", { name: "فضای کار" }));
    expect(setCollapsed).toHaveBeenCalledWith(false);
    view.rerender(<Sidebar {...props} collapsed={false} setCollapsed={setCollapsed} />);
    expect(view.getByRole("button", { name: "فضای کار" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("ignores malformed stored preferences", () => {
    window.localStorage.setItem(navigationStorageKey("12"), "invalid");
    const view = render(<Sidebar {...props} />);
    expect(view.getByRole("button", { name: "فضای کار" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("marks the registration destination active inside the cases group", () => {
    const navigate = vi.fn();
    const view = render(<Sidebar {...props} page="crm-property-register" navigate={navigate} />);
    const casesToggle = view.getByRole("button", { name: "پرونده‌ها" });
    fireEvent.click(casesToggle);
    expect(view.queryByRole("button", { name: "افزودن ملک" })).toBeNull();
    expect(view.queryByRole("button", { name: "ثبت ملک" })).toBeNull();
    const registerItem = view.getByRole("button", { name: "ثبت پرونده" });
    expect(registerItem.getAttribute("aria-current")).toBe("page");
    fireEvent.click(registerItem);
    expect(navigate).toHaveBeenCalledWith("add-property");
  });

  it("keeps every entry of a group in one aligned column", () => {
    const view = render(<Sidebar {...props} />);
    fireEvent.click(view.getByRole("button", { name: "پرونده‌ها" }));
    const panel = view.container.querySelector("#navigation-cases") as HTMLElement;
    const entries = Array.from(panel.querySelectorAll("button"));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const indent = entry.className.split(/\s+/).filter((token) => /^(p|px|pl|pr)-/.test(token));
      expect(indent.sort()).toEqual(["px-3"]);
    }
    // The creation shortcuts used to be indented ("عقب/جلو"), so they now share the same padding.
    expect(view.getByRole("button", { name: "ساخت فایل" }).className).not.toContain("pr-6");
    expect(view.getByRole("button", { name: "ثبت پرونده" }).className).not.toContain("pr-6");
    // The whole panel is inset one level, while the group heading stays in place.
    expect(panel.className).toContain("pr-6");
    expect(view.getByRole("button", { name: "پرونده‌ها" }).className).toContain("px-2.5");
  });

  it("separates unrelated entries with a thin divider inside the expanded group", () => {
    const view = render(<Sidebar {...props} />);
    fireEvent.click(view.getByRole("button", { name: "پرونده‌ها" }));
    const panel = view.container.querySelector("#navigation-cases") as HTMLElement;
    const sequence = Array.from(panel.children).map((child) =>
      child.getAttribute("role") === "separator"
        ? "—"
        : (child.querySelector("span")?.textContent || "").trim(),
    );
    expect(sequence).toEqual([
      "اشخاص", "—",
      "ثبت پرونده", "پرونده‌های ثبت ملک", "صف بررسی", "—",
      "ثبت درخواست متقاضی", "درخواست متقاضیان", "—",
      "املاک", "فایل‌های عرضه", "اکسپلور فایل‌های عرضه", "ساخت فایل",
    ]);
    // A divider never opens a group and never appears twice in a row.
    expect(sequence[0]).not.toBe("—");
    expect(sequence.some((entry, index) => entry === "—" && sequence[index + 1] === "—")).toBe(false);
    for (const separator of Array.from(panel.querySelectorAll('[role="separator"]'))) {
      expect(separator.className).toContain("border-t");
      expect(separator.className).toContain("border-sidebar-border");
    }
  });

  it("never opens a consultant group with a divider", () => {
    const view = render(<Sidebar {...props} role="consultant" page="my-followups" />);
    for (const heading of ["فضای کار", "پرونده‌ها", "پیگیری عملیات"]) {
      fireEvent.click(view.getByRole("button", { name: heading }));
    }
    for (const id of ["navigation-workspace", "navigation-cases", "navigation-operations"]) {
      const panel = view.container.querySelector(`#${id}`) as HTMLElement;
      expect(panel.firstElementChild?.tagName).toBe("BUTTON");
      expect(panel.querySelector('[role="separator"]')).not.toBeNull();
    }
  });
});
