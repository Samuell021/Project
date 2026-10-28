// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../shared/components/ui/PropertyMapPicker", () => ({
  PropertyMapPicker: () => <div data-testid="map-picker" />,
}));

const { PropertyRegisterPage } = await import("./pages/PropertyRegisterPage");

// A case that has already been approved and is sitting on the last step, so the page renders the
// listing form instead of the appraisal one.
const CASE = {
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
  acceptance_status: "ACCEPTED",
  status: "ACTIVE",
  stage: "listing",
  assigned_to: 9,
  assigned_to_name: "مشاور آزمون",
  property_title: "آپارتمان آزمون",
  description: "آپارتمان آزمون",
  version: 5,
  resulting_property: 88,
  appraisal: { report_text: "", visit_notes: "", findings: {}, is_complete: true },
};

const DEAL_TYPES = [
  {
    id: 3,
    name: "sale",
    display_name: "فروش",
    family: "SALE",
    is_active: true,
    published_version: {
      id: 7,
      version_number: 1,
      family: "SALE",
      terms_schema: {
        fields: [
          { key: "sale_price", label: "ثمن معامله", type: "integer", unit: "تومان", required: true },
          { key: "owner_share", label: "سهم مالک", type: "decimal", unit: "درصد", required: false },
        ],
      },
    },
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubApi(onListingPost?: (body: Record<string, unknown>) => void) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();

    if (url.includes("/crm/api/properties/88/listings/")) {
      if (method === "POST") {
        onListingPost?.(JSON.parse(String(init?.body || "{}")));
        return jsonResponse({ id: 501, status: "ACTIVE" }, 201);
      }
      return jsonResponse([]);
    }
    if (url.includes("/crm/api/property-cases/101/")) return jsonResponse(CASE);
    if (url.includes("/crm/api/property-cases/")) {
      return jsonResponse({ count: 1, next: null, previous: null, results: [CASE] });
    }
    if (url.includes("/crm/api/deal-types/")) {
      return jsonResponse({ count: DEAL_TYPES.length, next: null, previous: null, results: DEAL_TYPES });
    }
    if (url.includes("/properties/api/properties/88/")) {
      return jsonResponse({
        id: 88,
        title: "آپارتمان آزمون",
        type: "APARTMENT",
        propertyTypeRef: 6,
        propertyUsage: 5,
        area: 120,
        attributes: {},
        images: [],
        parties: [],
      });
    }
    if (url.includes("/basics/api/catalog/")) return jsonResponse({ usages: [], propertyTypes: [], dealTypes: [] });
    if (url.includes("/basics/api/locations/")) return jsonResponse({ count: 0, next: null, previous: null, results: [] });
    if (url.includes("/basics/api/schema/property-form/")) return jsonResponse({ fields: [], facilities: [] });
    return jsonResponse({ count: 0, next: null, previous: null, results: [] });
  });
}

/** Opens the last step and picks the only released deal type, which reveals the amount fields. */
async function openListingForm(onListingPost?: (body: Record<string, unknown>) => void) {
  vi.stubGlobal("fetch", stubApi(onListingPost));
  render(<PropertyRegisterPage csrfToken="token" role="admin" currentUserId="1" recordId="101" navigate={() => undefined} />);

  await screen.findByText(/مرحلهٔ ۷: تعریف و مدیریت فایل/, {}, { timeout: 8000 });
  const dealTypeSelect = screen.getByLabelText("نوع معامله (نسخهٔ منتشرشده)") as HTMLSelectElement;
  await waitFor(() => expect(dealTypeSelect.options.length).toBeGreaterThan(1));
  fireEvent.change(dealTypeSelect, { target: { value: "3" } });
  await screen.findByPlaceholderText("مبلغ به تومان");
}

const submitListing = () => {
  const form = screen.getByRole("button", { name: "ذخیره فایل عرضه" }).closest("form") as HTMLFormElement;
  fireEvent.submit(form);
};

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

describe("property registration listing step price fields", () => {
  it("groups the amount in threes while typing and writes it in Persian words under the field", async () => {
    await openListingForm();
    const amount = screen.getByPlaceholderText("مبلغ به تومان") as HTMLInputElement;

    expect(amount.type).toBe("text");
    expect(amount.getAttribute("inputMode")).toBe("numeric");
    // The custom label wrapper keeps the field reachable by its name, like the neighbouring ones.
    expect(screen.getByLabelText("ثمن معامله (تومان)")).toBe(amount);

    fireEvent.change(amount, { target: { value: "1500000000" } });
    expect(amount.value).toBe("1,500,000,000");
    expect(await screen.findByText("یک میلیارد و پانصد میلیون تومان")).toBeTruthy();

    // Persian digits typed by an operator are normalized to the same grouped amount.
    fireEvent.change(amount, { target: { value: "۲۵۰۰۰۰۰" } });
    expect(amount.value).toBe("2,500,000");
    expect(await screen.findByText("دو میلیون و پانصد هزار تومان")).toBeTruthy();

    // Non-money terms keep the plain number input and never grow a words line.
    const percentField = screen.getByText("سهم مالک (درصد)").parentElement!.querySelector("input") as HTMLInputElement;
    expect(percentField.type).toBe("number");
    expect(percentField.closest("label")!.querySelector("p")).toBeNull();
  }, 30000);

  it("submits the grouped amount as an integer term", async () => {
    const posts: Array<Record<string, unknown>> = [];
    await openListingForm((body) => posts.push(body));

    fireEvent.change(screen.getByPlaceholderText("مبلغ به تومان"), { target: { value: "1500000000" } });
    fireEvent.change(
      screen.getByText("سهم مالک (درصد)").parentElement!.querySelector("input")!,
      { target: { value: "40" } },
    );
    submitListing();

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      deal_type: 3,
      terms: { sale_price: 1500000000, owner_share: 40 },
      sale_price: 1500000000,
      deposit: null,
      monthly_rent: null,
      status: "ACTIVE",
    });
    expect(await screen.findByText("فایل عرضه ذخیره شد و نسخهٔ شرایط معامله ثبت گردید.")).toBeTruthy();
  }, 30000);

  it("blocks the submit with a Persian message when a required amount is missing", async () => {
    const posts: Array<Record<string, unknown>> = [];
    await openListingForm((body) => posts.push(body));

    submitListing();

    expect(await screen.findByText("وارد کردن ثمن معامله الزامی است.")).toBeTruthy();
    expect(posts).toHaveLength(0);
  }, 30000);
});
