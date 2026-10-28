// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../shared/components/ui/PropertyMapPicker", () => ({
  PropertyMapPicker: () => <div data-testid="map-picker" />,
}));

const { PropertyRegisterPage } = await import("./pages/PropertyRegisterPage");

const CONTACTS = [
  {
    id: 5,
    full_name: "مالک آزمون",
    national_code: "0012345678",
    phones: [{ id: 1, phone: "09121112233", is_primary: true }],
  },
  {
    // Indistinguishable copy of the same person: must not be listed twice.
    id: 6,
    full_name: "مالک آزمون",
    national_code: "0012345678",
    phones: [{ id: 2, phone: "09121112233", is_primary: true }],
  },
  {
    id: 7,
    full_name: "متقاضی آزمون",
    phones: [{ id: 3, phone: "09354445566", is_primary: true }],
  },
];

const DEAL_TYPES = [
  {
    id: 1,
    name: "sale",
    display_name: "فروش",
    family: "SALE",
    is_active: true,
    published_version: { id: 11, version_number: 1, family: "SALE", terms_schema: { fields: [] }, status: "PUBLISHED" },
  },
  {
    id: 2,
    name: "mortgage_rent",
    display_name: "رهن و اجاره",
    family: "RENT",
    is_active: true,
    published_version: { id: 12, version_number: 2, family: "RENT", terms_schema: { fields: [] }, status: "PUBLISHED" },
  },
  {
    // Nothing released yet: must stay out of the owner's choice.
    id: 3,
    name: "draft_only",
    display_name: "نوع بدون نسخه منتشرشده",
    family: "SALE",
    is_active: true,
    published_version: null,
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubApi(dealTypes: unknown[] = DEAL_TYPES, scopes: unknown[] = []) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/crm/api/scopes/")) {
      return jsonResponse({ count: scopes.length, next: null, previous: null, results: scopes });
    }
    if (url.includes("/crm/api/deal-types/")) {
      return jsonResponse({ count: dealTypes.length, next: null, previous: null, results: dealTypes });
    }
    if (url.includes("/crm/api/contacts/")) {
      return jsonResponse({ count: CONTACTS.length, next: null, previous: null, results: CONTACTS });
    }
    if (url.includes("/basics/api/catalog/")) return jsonResponse({ usages: [], propertyTypes: [], dealTypes: [] });
    if (url.includes("/basics/api/locations/")) return jsonResponse([]);
    return jsonResponse({ count: 0, next: null, previous: null, results: [] });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/app/property-register/");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("property registration lead step", () => {
  it("offers every released deal type to the owner and hides types without a released version", async () => {
    vi.stubGlobal("fetch", stubApi());
    render(<PropertyRegisterPage csrfToken="token" role="admin" currentUserId="1" navigate={() => undefined} />);

    await screen.findByText("فروش", {}, { timeout: 8000 });
    const chip = (label: string) => screen.getByText(label).closest("button") as HTMLButtonElement;
    const sale = chip("فروش");
    expect(chip("رهن و اجاره")).toBeTruthy();
    expect(screen.queryByText("نوع بدون نسخه منتشرشده")).toBeNull();

    // The chips are a real multi-select, not a decorative heading.
    fireEvent.click(sale);
    expect(sale.className).toContain("border-primary");
    fireEvent.click(sale);
    expect(sale.className).not.toContain("border-primary");
  }, 20000);

  it("submits a lead source the server accepts for every option in the dropdown", async () => {
    const posted: Array<Record<string, unknown>> = [];
    const baseFetch = stubApi();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        if (String(input).includes("/crm/api/property-cases/") && String(init?.method || "GET").toUpperCase() === "POST") {
          posted.push(JSON.parse(String(init?.body || "{}")));
          return jsonResponse({ id: 77, code: "PR-77", stage: "reception", version: 1 }, 201);
        }
        return baseFetch(input);
      }),
    );
    render(<PropertyRegisterPage csrfToken="token" role="admin" currentUserId="1" navigate={() => undefined} />);

    // Only codes from `apps.crm.models.LeadSource` are allowed; anything else answers 400.
    const EXPECTED = ["OWNER_REFERRAL", "ADVISOR_NETWORK", "PORTAL", "REFERRAL", "WALK_IN", "OTHER"];
    const firstSelect = (await screen.findByLabelText("منبع سرنخ", {}, { timeout: 8000 })) as HTMLSelectElement;
    expect(Array.from(firstSelect.options).map((option) => option.value)).toEqual(EXPECTED);

    for (const [index, value] of EXPECTED.entries()) {
      cleanup();
      window.localStorage.clear();
      window.history.replaceState({}, "", "/app/property-register/");
      render(<PropertyRegisterPage csrfToken="token" role="admin" currentUserId="1" navigate={() => undefined} />);

      fireEvent.click(await screen.findByRole("button", { name: "ثبت شخص جدید" }, { timeout: 8000 }));
      fireEvent.change(screen.getByLabelText("منبع سرنخ"), { target: { value } });
      fireEvent.change(screen.getByLabelText("نام کامل مالک / معرف (الزامی)"), { target: { value: "مالک آزمون" } });
      fireEvent.change(screen.getByLabelText("شماره تماس (الزامی)"), { target: { value: "09121112233" } });
      fireEvent.change(screen.getByLabelText("خلاصهٔ اولیهٔ ملک و توضیحات سرنخ (الزامی)"), {
        target: { value: `سرنخ با منبع ${value}` },
      });
      fireEvent.click(screen.getByRole("button", { name: "ثبت سرنخ و ایجاد پرونده" }));
      await waitFor(() => expect(posted).toHaveLength(index + 1), { timeout: 8000 });
      expect(posted[index].lead_source).toBe(value);
    }
  }, 40000);

  it("repairs a stale draft that stored a lead source the server rejects", async () => {
    // Drafts written by an older build contain codes such as DIRECT_CALL, which the API refuses.
    window.localStorage.setItem(
      "zaminex:supply-draft:v1:1:new",
      JSON.stringify({ schemaVersion: 1, savedAt: "", baseVersion: null, fields: { leadSource: "DIRECT_CALL" } }),
    );
    const posted: Array<Record<string, unknown>> = [];
    const baseFetch = stubApi();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        if (String(input).includes("/crm/api/property-cases/") && String(init?.method || "GET").toUpperCase() === "POST") {
          posted.push(JSON.parse(String(init?.body || "{}")));
          return jsonResponse({ id: 78, code: "PR-78", stage: "reception", version: 1 }, 201);
        }
        return baseFetch(input);
      }),
    );
    render(<PropertyRegisterPage csrfToken="token" role="admin" currentUserId="1" navigate={() => undefined} />);

    const select = (await screen.findByLabelText("منبع سرنخ", {}, { timeout: 8000 })) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("OWNER_REFERRAL"));
    fireEvent.click(screen.getByRole("button", { name: "ثبت شخص جدید" }));
    fireEvent.change(screen.getByLabelText("نام کامل مالک / معرف (الزامی)"), { target: { value: "مالک آزمون" } });
    fireEvent.change(screen.getByLabelText("شماره تماس (الزامی)"), { target: { value: "09121112233" } });
    fireEvent.change(screen.getByLabelText("خلاصهٔ اولیهٔ ملک و توضیحات سرنخ (الزامی)"), { target: { value: "سرنخ قدیمی" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت سرنخ و ایجاد پرونده" }));
    await waitFor(() => expect(posted).toHaveLength(1), { timeout: 8000 });
    expect(posted[0].lead_source).toBe("OWNER_REFERRAL");
  }, 30000);

  it("lists each CRM person once inside the searchable picker", async () => {
    vi.stubGlobal("fetch", stubApi());
    render(<PropertyRegisterPage csrfToken="token" role="admin" currentUserId="1" navigate={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: /انتخاب از اشخاص موجود/ }, { timeout: 8000 }));
    fireEvent.click(await screen.findByRole("button", { name: /انتخاب شخص/ }, { timeout: 8000 }));

    const list = () => within(document.querySelector('[role="listbox"]') as HTMLElement).getAllByRole("option");
    await waitFor(() => expect(list()).toHaveLength(2), { timeout: 8000 });
    // The indistinguishable copy of the same person is collapsed, not repeated.
    expect(within(document.querySelector('[role="listbox"]') as HTMLElement).getAllByText("مالک آزمون")).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("جستجو در اشخاص"), { target: { value: "متقاضی" } });
    expect(list()).toHaveLength(1);
  }, 20000);
  it("sends the consultant's own range so the lead lands where the manager waits for it", async () => {
    const posted: Array<Record<string, unknown>> = [];
    const baseFetch = stubApi(DEAL_TYPES, [{ id: 5, name: "رنج شمال", is_active: true }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        if (String(input).includes("/crm/api/property-cases/") && String(init?.method || "GET").toUpperCase() === "POST") {
          posted.push(JSON.parse(String(init?.body || "{}")));
          return jsonResponse({ id: 90, code: "PR-90", stage: "reception", version: 1 }, 201);
        }
        return baseFetch(input);
      }),
    );
    render(<PropertyRegisterPage csrfToken="token" role="consultant" currentUserId="9" navigate={() => undefined} />);

    // The single range is shown before anything is typed, instead of being decided silently.
    expect(await screen.findByText("رنج شمال", {}, { timeout: 8000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ثبت شخص جدید" }));
    fireEvent.change(screen.getByLabelText("نام کامل مالک / معرف (الزامی)"), { target: { value: "مالک آزمون" } });
    fireEvent.change(screen.getByLabelText("شماره تماس (الزامی)"), { target: { value: "09121112233" } });
    fireEvent.change(screen.getByLabelText("خلاصهٔ اولیهٔ ملک و توضیحات سرنخ (الزامی)"), {
      target: { value: "آپارتمان آزمون" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ثبت سرنخ و ایجاد پرونده" }));

    await waitFor(() => expect(posted).toHaveLength(1), { timeout: 8000 });
    expect(posted[0].sales_range).toBe(5);
  }, 30000);

  it("warns a consultant without an active range instead of losing the filled form", async () => {
    const fetchMock = stubApi(DEAL_TYPES, []);
    vi.stubGlobal("fetch", fetchMock);
    render(<PropertyRegisterPage csrfToken="token" role="consultant" currentUserId="9" navigate={() => undefined} />);

    expect(await screen.findByText("حساب شما به هیچ رنج فعالی متصل نیست.", {}, { timeout: 8000 })).toBeTruthy();
    const submit = screen.getByRole("button", { name: "ثبت سرنخ و ایجاد پرونده" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(submit);
    const posts = fetchMock.mock.calls.filter(
      ([, init]) => String((init as RequestInit | undefined)?.method || "GET").toUpperCase() === "POST",
    );
    expect(posts).toHaveLength(0);
  }, 30000);

  it("keeps the range out of the payload for a general manager", async () => {
    // A general manager opens cases without a range; the panel must not force one on them.
    const posted: Array<Record<string, unknown>> = [];
    const baseFetch = stubApi(DEAL_TYPES, [{ id: 5, name: "رنج شمال", is_active: true }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        if (String(input).includes("/crm/api/property-cases/") && String(init?.method || "GET").toUpperCase() === "POST") {
          posted.push(JSON.parse(String(init?.body || "{}")));
          return jsonResponse({ id: 92, code: "PR-92", stage: "reception", version: 1 }, 201);
        }
        return baseFetch(input);
      }),
    );
    render(<PropertyRegisterPage csrfToken="token" role="admin" currentUserId="1" navigate={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "ثبت شخص جدید" }, { timeout: 8000 }));
    fireEvent.change(screen.getByLabelText("نام کامل مالک / معرف (الزامی)"), { target: { value: "مالک آزمون" } });
    fireEvent.change(screen.getByLabelText("شماره تماس (الزامی)"), { target: { value: "09121112233" } });
    fireEvent.change(screen.getByLabelText("خلاصهٔ اولیهٔ ملک و توضیحات سرنخ (الزامی)"), {
      target: { value: "آپارتمان آزمون" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ثبت سرنخ و ایجاد پرونده" }));

    await waitFor(() => expect(posted).toHaveLength(1), { timeout: 8000 });
    expect(posted[0].sales_range).toBeUndefined();
  }, 30000);

  it("treats a deactivated range as no range and lets the consultant choose between several", async () => {
    // A deactivated range must not be offered: the server refuses cases in it.
    vi.stubGlobal("fetch", stubApi(DEAL_TYPES, [{ id: 5, name: "رنج قدیمی", is_active: false }]));
    render(<PropertyRegisterPage csrfToken="token" role="consultant" currentUserId="9" navigate={() => undefined} />);
    expect(await screen.findByText("حساب شما به هیچ رنج فعالی متصل نیست.", {}, { timeout: 8000 })).toBeTruthy();
    cleanup();

    const posted: Array<Record<string, unknown>> = [];
    const baseFetch = stubApi(DEAL_TYPES, [
      { id: 5, name: "رنج شمال", is_active: true },
      { id: 6, name: "رنج جنوب", is_active: true },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        if (String(input).includes("/crm/api/property-cases/") && String(init?.method || "GET").toUpperCase() === "POST") {
          posted.push(JSON.parse(String(init?.body || "{}")));
          return jsonResponse({ id: 91, code: "PR-91", stage: "reception", version: 1 }, 201);
        }
        return baseFetch(input);
      }),
    );
    render(<PropertyRegisterPage csrfToken="token" role="consultant" currentUserId="9" navigate={() => undefined} />);

    const rangeSelect = (await screen.findByLabelText("رنج پرونده (الزامی)", {}, { timeout: 8000 })) as HTMLSelectElement;
    expect(Array.from(rangeSelect.options).map((option) => option.textContent)).toEqual(["رنج شمال", "رنج جنوب"]);
    fireEvent.change(rangeSelect, { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت شخص جدید" }));
    fireEvent.change(screen.getByLabelText("نام کامل مالک / معرف (الزامی)"), { target: { value: "مالک آزمون" } });
    fireEvent.change(screen.getByLabelText("شماره تماس (الزامی)"), { target: { value: "09121112233" } });
    fireEvent.change(screen.getByLabelText("خلاصهٔ اولیهٔ ملک و توضیحات سرنخ (الزامی)"), {
      target: { value: "آپارتمان آزمون" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ثبت سرنخ و ایجاد پرونده" }));

    await waitFor(() => expect(posted).toHaveLength(1), { timeout: 8000 });
    expect(posted[0].sales_range).toBe(6);
  }, 30000);
});
