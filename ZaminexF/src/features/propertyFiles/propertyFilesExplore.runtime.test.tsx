// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PropertyFilesPage } from "./pages/PropertyFilesPage";
import type { PropertyFileExploreDetail, PropertyFileExploreItem } from "../../shared/lib/propertyFileExplore";

vi.mock("../../shared/lib/useAttributeSchema", () => ({
  useBasicsCatalog: () => ({
    catalog: {
      dealTypes: [
        { id: 1, name: "sale", displayName: "فروش" },
        { id: 2, name: "rent", displayName: "اجاره" },
      ],
      propertyTypes: [
        { id: 10, name: "apartment", displayName: "آپارتمان" },
        { id: 11, name: "villa", displayName: "ویلا" },
      ],
    },
  }),
}));

const base: PropertyFileExploreItem = {
  id: 1, title: "فایل فروش تست", description: "", dealTypeId: 1,
  dealTypeDisplay: "فروش", propertyTitle: "ملک تست", propertyType: "آپارتمان",
  area: 100, district: "مرکز", city: "تهران", imageUrl: null,
  consultantId: 2, consultantName: "کارشناس تست", consultantAvatar: null,
  channel: "WEBSITE", channelDisplay: "وب‌سایت", propertyId: 10,
  isMine: false, salePrice: "9000000000",
};
const cases = [
  { name: "sale", item: base, label: "قیمت فروش ۹ میلیارد تومان" },
  { name: "rent", item: { ...base, id: 2, title: "فایل اجاره تست", salePrice: null,
    dealTypeDisplay: "اجاره", deposit: "500000000", monthlyRent: "30000000" },
    label: "اجاره ماهانه ۳۰ میلیون تومان · ودیعه ۵۰۰ میلیون تومان" },
  { name: "mortgage", item: { ...base, id: 3, title: "فایل رهن تست", salePrice: null,
    dealTypeDisplay: "رهن کامل", deposit: "2000000000" }, label: "برای رهن ۲ میلیارد تومان" },
  { name: "negotiable", item: { ...base, id: 4, title: "فایل توافقی تست", salePrice: null },
    label: "قیمت توافقی" },
];

const fetchMock = vi.fn<typeof fetch>();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});
const mountExplore = (navigate = vi.fn()) => render(<PropertyFilesPage
  navigate={navigate} role="consultant" initialTab="explore" consultants={[]}
  properties={[]} propertyFiles={[]} onAction={vi.fn()} loading={false}
/>);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("explore after API data arrives (rename regression)", () => {
  // SSR/empty-list tests never reached the price formatter that crashed the app.
  it("renders populated cards with every supported price shape", async () => {
    fetchMock.mockResolvedValue(json({ count: cases.length, results: cases.map(({ item }) => item) }));
    mountExplore();
    for (const { item, label } of cases) {
      expect(await screen.findByRole("heading", { name: item.title })).toBeTruthy();
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getAllByText("کارشناس تست")).toHaveLength(cases.length);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/^\/property-files\/api\/property-files\/explore\/\?/);
  });

  it.each(cases)("renders loaded $name details through the read-only endpoint", async ({ item, label }) => {
    const detail: PropertyFileExploreDetail = {
      ...item, status: "ACTIVE", publishChannel: item.channel, start_date: null,
      end_date: null, created_at: "2026-10-23T08:00:00Z", property_detail: null,
      attributeDetails: [],
    };
    fetchMock.mockImplementation(async (url) => {
      if (String(url) === `/property-files/api/property-files/explore/${item.id}/`) return json(detail);
      if (String(url).startsWith("/property-files/api/property-files/explore/?")) {
        return json({ count: 1, results: [item] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const navigate = vi.fn();
    mountExplore(navigate);
    await screen.findByRole("heading", { name: item.title });
    fireEvent.click(screen.getByRole("button", { name: "جزئیات" }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("heading", { name: item.title })).toBeTruthy();
    expect(within(dialog).getByText(label)).toBeTruthy();
    expect(within(dialog).getByText("فقط‌خواندنی")).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(within(dialog).getByRole("button", { name: "بستن جزئیات فایل" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: item.title })).toBeTruthy();
  });

  it("preserves the private detail target for an owned file", async () => {
    fetchMock.mockResolvedValue(json({ count: 1, results: [{ ...base, isMine: true }] }));
    const navigate = vi.fn();
    mountExplore(navigate);
    await screen.findByRole("heading", { name: base.title });
    fireEvent.click(screen.getByRole("button", { name: "جزئیات" }));
    expect(navigate).toHaveBeenCalledWith("property-file-detail", base.id);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows an actionable error rather than losing the page on a failed request", async () => {
    fetchMock.mockResolvedValue(json({ detail: "دریافت فایل‌ها انجام نشد." }, 500));
    mountExplore();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("region", { name: "اکسپلور فایل‌ها" })).toBeTruthy();
  });
});

describe("MatchAssistantDrawer («دستیار تطبیقی») end-to-end runtime verification", () => {
  const bestCandidate: PropertyFileExploreItem = {
    ...base,
    id: 101,
    title: "آپارتمان سعادت‌آباد کلیدنخورده",
    propertyTitle: "برج باغ سعادت‌آباد",
    propertyType: "آپارتمان",
    area: 105,
    city: "تهران",
    district: "سعادت‌آباد",
    consultantName: "سارا محمدی",
    isMine: false,
    salePrice: "8400000000",
  };
  const mineCandidate: PropertyFileExploreItem = {
    ...base,
    id: 102,
    title: "واحد ونک بازسازی‌شده",
    propertyTitle: "ساختمان پارک ونک",
    propertyType: "آپارتمان",
    area: 128,
    city: "تهران",
    district: "ونک",
    consultantName: "رضا کریمی",
    isMine: true,
    salePrice: "12600000000",
  };

  it("steps through all 4 stages, validates area, scores recommendations, filters mine, and opens detail modal cleanly", async () => {
    const recommendationUrls: string[] = [];
    const detailPayload: PropertyFileExploreDetail = {
      ...bestCandidate,
      status: "ACTIVE",
      publishChannel: bestCandidate.channel,
      start_date: null,
      end_date: null,
      created_at: "2026-10-23T08:30:00Z",
      property_detail: null,
      attributeDetails: [],
    };

    fetchMock.mockImplementation(async (url) => {
      const targetUrl = String(url);
      if (targetUrl.startsWith("/property-files/api/property-files/explore/?")) {
        return json({ count: 0, results: [] });
      }
      if (targetUrl.startsWith("/property-files/api/property-files/recommendations/?")) {
        recommendationUrls.push(targetUrl);
        const parsed = new URL(targetUrl, "https://zaminex.test");
        const results =
          parsed.searchParams.get("scope") === "mine"
            ? [mineCandidate]
            : [mineCandidate, bestCandidate];
        return json({ count: results.length, results });
      }
      if (targetUrl === `/property-files/api/property-files/explore/${bestCandidate.id}/`) {
        return json(detailPayload);
      }
      throw new Error(`Unexpected URL: ${targetUrl}`);
    });

    const navigate = vi.fn();
    mountExplore(navigate);

    // Open «دستیار تطبیقی» from Explore header
    fireEvent.click(screen.getByRole("button", { name: /دستیار تطبیقی/ }));
    const drawer = screen.getByRole("dialog", { name: "دستیار تطبیقی" });
    expect(drawer).toBeTruthy();

    // Step 1: Select deal type «فروش» and property type «آپارتمان»
    fireEvent.click(within(drawer).getByRole("button", { name: /فروش.*فایل‌های فعال این نوع معامله/s }));
    fireEvent.click(within(drawer).getByRole("button", { name: "آپارتمان" }));
    fireEvent.click(within(drawer).getByRole("button", { name: /ادامه/ }));

    // Step 2: Select budget preset «۱۲٬۰۰۰» (12 billion Toman)
    expect(within(drawer).getByText("سقف بودجهٔ خرید")).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: "۱۲٬۰۰۰" }));
    fireEvent.click(within(drawer).getByRole("button", { name: /ادامه/ }));

    // Step 3: Validate area (min > max blocks «ادامه»), then select preset «۸۰ تا ۱۲۰ متر»
    const areaMinInput = within(drawer).getByPlaceholderText("۸۰");
    const areaMaxInput = within(drawer).getByPlaceholderText("۱۲۰");
    fireEvent.change(areaMinInput, { target: { value: "130" } });
    fireEvent.change(areaMaxInput, { target: { value: "90" } });
    expect(within(drawer).getByRole("alert").textContent).toContain("حداکثر متراژ باید بزرگ‌تر از حداقل باشد.");
    expect((within(drawer).getByRole("button", { name: /ادامه/ }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(drawer).getByRole("button", { name: "۸۰ تا ۱۲۰ متر" }));
    expect(within(drawer).queryByRole("alert")).toBeNull();
    fireEvent.click(within(drawer).getByRole("button", { name: /ادامه/ }));

    // Step 4: Enter city & district, inspect draft summary chips, submit
    fireEvent.change(within(drawer).getByPlaceholderText("مثلاً تهران"), { target: { value: "تهران" } });
    fireEvent.change(within(drawer).getByPlaceholderText("مثلاً سعادت‌آباد"), { target: { value: "سعادت‌آباد" } });
    expect(within(drawer).getByText("تهران، سعادت‌آباد")).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: /تحلیل و پیشنهاد فایل/ }));

    // Ranked recommendations render cleanly without ReferenceError, with bestCandidate ranked #1
    expect(await within(drawer).findByText(bestCandidate.title)).toBeTruthy();
    expect(within(drawer).getByText(mineCandidate.title)).toBeTruthy();
    expect(within(drawer).getByText("بهترین گزینه")).toBeTruthy();
    expect(within(drawer).getByText("سارا محمدی")).toBeTruthy();
    expect(within(drawer).getByText("رضا کریمی")).toBeTruthy();
    expect(within(drawer).getByText("فقط‌خواندنی")).toBeTruthy();
    expect(within(drawer).getByText("فایل من")).toBeTruthy();

    expect(recommendationUrls).toHaveLength(1);
    const firstQuery = new URL(recommendationUrls[0], "https://zaminex.test").searchParams;
    expect(firstQuery.get("dealType")).toBe("1");
    expect(firstQuery.get("propertyTypeRef")).toBe("10");
    expect(firstQuery.get("city")).toBe("تهران");
    expect(firstQuery.get("areaMin")).toBe("68");
    expect(firstQuery.get("areaMax")).toBe("138");
    expect(firstQuery.get("saleMax")).toBe("13800000000");

    // Clicking other-consultant recommendation opens read-only PropertyFileDetailModal ON TOP without losing drawer
    fireEvent.click(within(drawer).getByText(bestCandidate.title));
    const detailDialog = await screen.findByRole("dialog", { name: "جزئیات فایل و معرفی به مشتری" });
    expect(await within(detailDialog).findByRole("heading", { name: bestCandidate.title })).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();

    // Pressing Escape closes ONLY PropertyFileDetailModal while preserving MatchAssistantDrawer & results
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "جزئیات فایل و معرفی به مشتری" })).toBeNull();
    });
    expect(screen.getByRole("dialog", { name: "دستیار تطبیقی" })).toBeTruthy();
    expect(within(drawer).getByText(bestCandidate.title)).toBeTruthy();

    // Toggling «فقط فایل‌های خودم» sends scope=mine and shows only owned recommendation
    fireEvent.click(within(drawer).getByLabelText("فقط فایل‌های خودم"));
    await waitFor(() => {
      expect(recommendationUrls).toHaveLength(2);
    });
    expect(new URL(recommendationUrls[1], "https://zaminex.test").searchParams.get("scope")).toBe("mine");
    expect(await within(drawer).findByText(mineCandidate.title)).toBeTruthy();
    expect(within(drawer).queryByText(bestCandidate.title)).toBeNull();

    // Clicking owned recommendation closes drawer and navigates directly to property-file-detail
    fireEvent.click(within(drawer).getByText(mineCandidate.title));
    expect(navigate).toHaveBeenCalledWith("property-file-detail", mineCandidate.id);
    expect(screen.queryByRole("dialog", { name: "دستیار تطبیقی" })).toBeNull();
  });
});
