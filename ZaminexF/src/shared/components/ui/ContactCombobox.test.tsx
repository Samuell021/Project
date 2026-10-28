// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContactCombobox, buildContactItems } from "./ContactCombobox";

const ROWS = [
  {
    id: 7,
    full_name: "رضا کریمی",
    national_code: "0012345678",
    phones: [{ id: 1, phone: "09121234567", is_primary: true }],
  },
  {
    // The same person stored twice: collapsed.
    id: 8,
    full_name: "رضا کریمی",
    national_code: "0012345678",
    phones: [{ id: 2, phone: "09121234567", is_primary: true }],
  },
  {
    // Another person with the same name but a different number: kept.
    id: 9,
    full_name: "رضا  کریمی",
    phones: [{ id: 3, phone: "09350001122", is_primary: true }],
  },
  {
    id: 10,
    full_name: "مریم اسدی",
    phones: [{ id: 4, phone: "۰۹۱۲۹۹۹۸۸۷۷", is_primary: true }],
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("buildContactItems", () => {
  it("collapses rows that name the same person with the same number", () => {
    const items = buildContactItems(ROWS);
    expect(items.map((item) => item.id)).toEqual(["7", "9", "10"]);
  });

  it("keeps different people who share a name and shows their numbers", () => {
    const items = buildContactItems(ROWS);
    const sameName = items.filter((item) => item.name.startsWith("رضا"));
    expect(sameName).toHaveLength(2);
    expect(sameName.map((item) => item.phone)).toEqual(["09121234567", "09350001122"]);
  });

  it("never emits the same id or the same name+number twice", () => {
    const items = buildContactItems([...ROWS, ...ROWS]);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    expect(new Set(items.map((item) => `${item.name}|${item.phone}`)).size).toBe(items.length);
  });

  it("skips rows without a name and tolerates a missing phone list", () => {
    const items = buildContactItems([{ id: 1, full_name: "  " }, { id: 2, full_name: "سارا", phone: "09120000000" }]);
    expect(items).toHaveLength(1);
    expect(items[0].phone).toBe("09120000000");
  });

  it("returns an empty list for missing data", () => {
    expect(buildContactItems(undefined)).toEqual([]);
    expect(buildContactItems(null)).toEqual([]);
  });
});

describe("ContactCombobox", () => {
  it("lists every distinct person once and filters inside the open list", () => {
    render(<ContactCombobox value="" onChange={() => undefined} contacts={ROWS} label="شخص موجود در CRM" />);
    fireEvent.click(screen.getByRole("button", { name: /انتخاب شخص/ }));

    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getAllByText("رضا کریمی")).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("جستجو در اشخاص"), { target: { value: "0912999" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("مریم اسدی");
  });

  it("reports the chosen person id", () => {
    const onChange = vi.fn();
    render(<ContactCombobox value="" onChange={onChange} contacts={ROWS} />);
    fireEvent.click(screen.getByRole("button", { name: /انتخاب شخص/ }));
    fireEvent.click(screen.getAllByRole("option")[1]);
    expect(onChange).toHaveBeenCalledWith("9");
  });

  it("shows the selected person and the empty state", () => {
    const { rerender } = render(<ContactCombobox value="10" onChange={() => undefined} contacts={ROWS} />);
    expect(screen.getByRole("button", { name: /مریم اسدی/ })).toBeTruthy();

    rerender(<ContactCombobox value="" onChange={() => undefined} contacts={[]} loading />);
    expect(screen.getByText("در حال بارگذاری اشخاص…")).toBeTruthy();

    rerender(<ContactCombobox value="" onChange={() => undefined} contacts={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /انتخاب شخص/ }));
    expect(screen.getByText("شخصی در CRM ثبت نشده است")).toBeTruthy();
  });
});
