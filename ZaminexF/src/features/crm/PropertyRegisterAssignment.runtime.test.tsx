// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../shared/components/ui/PropertyMapPicker", () => ({
  PropertyMapPicker: () => <div data-testid="map-picker" />,
}));

const { PropertyRegisterPage } = await import("./pages/PropertyRegisterPage");

const baseCase = {
  id: 101,
  code: "PC-101",
  contact: 11,
  contact_name: "مالک آزمون",
  contact_phones: ["09121112233"],
  scope: 1,
  scope_name: "رنج شمال",
  sales_range: 1,
  sales_range_name: "رنج شمال",
  lead_status: "ACCEPTED",
  acceptance_status: "PENDING",
  status: "ACTIVE",
  stage: "assignment",
  assigned_to: null,
  assigned_to_name: null,
  property_title: "",
  description: "آپارتمان آزمون",
  version: 2,
  resulting_property: null,
  appraisal: null,
};

const ASSIGNABLE = [
  { id: 4, full_name: "مشاور نمونه یک", role: "AGENT", branch: "دفتر مرکزی", profile_image: null },
  // The server repeats a person only by mistake; the picker keeps one row.
  { id: 4, full_name: "مشاور نمونه یک", role: "AGENT", branch: "دفتر مرکزی", profile_image: null },
  { id: 2, full_name: "مدیر رنج شمال", role: "RANGE_MANAGER", branch: "دفتر مرکزی", profile_image: null },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubApi(assignable: unknown[]) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/assignable-staff/")) return json(assignable);
    if (url.includes("/crm/api/property-cases/101/")) return json(baseCase);
    if (url.includes("/basics/api/catalog/")) return json({ usages: [], propertyTypes: [], dealTypes: [] });
    if (url.includes("/basics/api/locations/")) return json([]);
    return json({ count: 0, next: null, previous: null, results: [] });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/app/property-register/?id=101");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("property registration assignment step", () => {
  it("lists the staff the server would accept, once each", async () => {
    vi.stubGlobal("fetch", stubApi(ASSIGNABLE));
    render(
      <PropertyRegisterPage csrfToken="token" role="admin" currentUserId="1" recordId="101" navigate={() => undefined} />,
    );

    const trigger = await screen.findByRole("button", { name: /انتخاب کارشناس/ }, { timeout: 8000 });
    fireEvent.click(trigger);

    await waitFor(() => expect(screen.getByText("مدیر رنج شمال")).toBeTruthy(), { timeout: 8000 });
    // The duplicate row the server sent is collapsed into a single entry.
    expect(screen.getAllByText("مشاور نمونه یک")).toHaveLength(1);

    // Search inside the list, like the consultant combobox in the rest of the app.
    fireEvent.change(screen.getByPlaceholderText("جستجوی نام، نقش، شعبه…"), { target: { value: "شمال" } });
    await waitFor(() => expect(screen.queryByText("مشاور نمونه یک")).toBeNull());
    // The matched part is highlighted, so the row is reached through the marked fragment.
    const filteredRow = screen.getByText("شمال").closest("button") as HTMLButtonElement;
    expect(filteredRow.textContent).toContain("مدیر رنج شمال");

    fireEvent.click(filteredRow);
    await waitFor(() => expect((trigger as HTMLButtonElement).textContent).toContain("مدیر رنج شمال"));
  }, 20000);

  it("uses the project's Jalali calendar for the appraisal deadline", async () => {
    vi.stubGlobal("fetch", stubApi(ASSIGNABLE));
    render(
      <PropertyRegisterPage csrfToken="token" role="admin" currentUserId="1" recordId="101" navigate={() => undefined} />,
    );

    // No native browser date control survives on this step.
    await screen.findByRole("button", { name: /انتخاب کارشناس/ }, { timeout: 8000 });
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();

    const dateButton = screen.getByText("انتخاب تاریخ").closest("button") as HTMLButtonElement;
    fireEvent.click(dateButton);
    expect(await screen.findByRole("dialog", { name: "تقویم شمسی" })).toBeTruthy();
    expect(screen.getByText("امروز")).toBeTruthy();
  }, 20000);

  it("explains an empty candidate list instead of rendering an empty select", async () => {
    vi.stubGlobal("fetch", stubApi([]));
    render(
      <PropertyRegisterPage csrfToken="token" role="admin" currentUserId="1" recordId="101" navigate={() => undefined} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /انتخاب کارشناس/ }, { timeout: 8000 }));
    await waitFor(() => expect(screen.getByText("کارشناسی یافت نشد")).toBeTruthy());
  }, 20000);
});
