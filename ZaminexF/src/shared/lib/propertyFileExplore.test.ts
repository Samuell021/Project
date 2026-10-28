import { describe, expect, it } from "vitest";
import {
  EMPTY_PROPERTY_FILE_EXPLORE_FILTERS,
  EMPTY_PROPERTY_FILE_INQUIRY,
  EMPTY_PROPERTY_FILE_MATCH_CRITERIA,
  EMPTY_MATCH_BRIEF,
  PROPERTY_FILE_CHANNEL_CODES,
  buildPropertyFileExploreParams,
  buildPropertyFileInquiryPayload,
  buildPropertyFileMatchParams,
  buildMatchEngineParams,
  consultantInitials,
  propertyFileInquiryValidationError,
  propertyFilePriceLabel,
  propertyFilePriceParts,
  matchBriefToCriteria,
  matchCriteriaBudgetText,
  matchDealKind,
  rankPropertyFileMatches,
  scorePropertyFileMatch,
} from "./propertyFileExplore";
import { toPersianChannel } from "./utils";

describe("buildPropertyFileExploreParams", () => {
  it("always carries pagination", () => {
    const params = buildPropertyFileExploreParams(EMPTY_PROPERTY_FILE_EXPLORE_FILTERS, 0, 0);
    expect(params.get("page")).toBe("1");
    expect(params.get("page_size")).toBe("1");
    expect([...params.keys()]).toEqual(["page", "page_size"]);
  });

  it("drops blank filters and trims the rest", () => {
    const params = buildPropertyFileExploreParams(
      {
        ...EMPTY_PROPERTY_FILE_EXPLORE_FILTERS,
        q: "  آپارتمان  ",
        channel: "INSTAGRAM",
        dealType: "3",
        propertyTypeRef: "",
        city: "تهران",
        district: "   ",
        areaMin: "80",
        areaMax: "",
      },
      2,
      12
    );
    expect(params.get("page")).toBe("2");
    expect(params.get("page_size")).toBe("12");
    expect(params.get("q")).toBe("آپارتمان");
    expect(params.get("channel")).toBe("INSTAGRAM");
    expect(params.get("dealType")).toBe("3");
    expect(params.get("city")).toBe("تهران");
    expect(params.get("areaMin")).toBe("80");
    expect(params.has("propertyTypeRef")).toBe(false);
    expect(params.has("district")).toBe(false);
    expect(params.has("areaMax")).toBe(false);
  });

  it("keeps an explicit zero area bound", () => {
    const params = buildPropertyFileExploreParams(
      { ...EMPTY_PROPERTY_FILE_EXPLORE_FILTERS, areaMin: "0" },
      1,
      20
    );
    expect(params.get("areaMin")).toBe("0");
  });
});

describe("buildPropertyFileMatchParams", () => {
  const criteria = { ...EMPTY_PROPERTY_FILE_EXPLORE_FILTERS };

  it("searches every consultant by default", () => {
    const params = buildPropertyFileMatchParams(criteria, 1, 12, false);
    expect(params.has("scope")).toBe(false);
    expect(params.has("channel")).toBe(false);
  });

  it("narrows to the signed in consultant on demand", () => {
    const params = buildPropertyFileMatchParams({ ...criteria, dealType: "2" }, 1, 12, true);
    expect(params.get("scope")).toBe("mine");
    expect(params.get("dealType")).toBe("2");
  });
});

describe("propertyFilePriceParts", () => {
  it("ignores invalid amounts without changing the input file", () => {
    const propertyFile = Object.freeze({ salePrice: "invalid", deposit: -100, monthlyRent: Infinity });
    expect(propertyFilePriceParts(propertyFile)).toEqual([]);
    expect(propertyFilePriceLabel(propertyFile)).toBe("قیمت توافقی");
    expect(propertyFile).toEqual({ salePrice: "invalid", deposit: -100, monthlyRent: Infinity });
  });

  it("formats each file independently when rendering a populated result list", () => {
    const propertyFiles = [
      Object.freeze({ salePrice: "9000000000", dealTypeDisplay: "فروش" }),
      Object.freeze({ deposit: "2000000000", dealTypeName: "رهن کامل" }),
      Object.freeze({}),
    ];
    expect(propertyFiles.map(propertyFilePriceLabel)).toEqual([
      "قیمت فروش ۹ میلیارد تومان",
      "برای رهن ۲ میلیارد تومان",
      "قیمت توافقی",
    ]);
  });

  it("returns an empty list for a negotiable propertyFile", () => {
    expect(propertyFilePriceParts({})).toEqual([]);
    expect(propertyFilePriceLabel({})).toBe("قیمت توافقی");
    expect(propertyFilePriceLabel({ salePrice: "0", deposit: "0", monthlyRent: null })).toBe("قیمت توافقی");
  });

  it("labels mortgage only deals", () => {
    expect(propertyFilePriceParts({ deposit: "2000000000", dealTypeDisplay: "رهن کامل" })).toEqual([
      { label: "برای رهن", value: 2000000000 },
    ]);
  });

  it("labels rent deals with rent first", () => {
    expect(
      propertyFilePriceParts({
        deposit: "500000000",
        monthlyRent: "30000000",
        dealTypeDisplay: "اجاره",
      })
    ).toEqual([
      { label: "اجاره ماهانه", value: 30000000 },
      { label: "ودیعه", value: 500000000 },
    ]);
  });

  it("labels sale and pre sale deals", () => {
    expect(propertyFilePriceParts({ salePrice: "9000000000", dealTypeDisplay: "فروش" })).toEqual([
      { label: "قیمت فروش", value: 9000000000 },
    ]);
    expect(propertyFilePriceParts({ salePrice: "9000000000", dealTypeDisplay: "پیش‌فروش" })).toEqual([
      { label: "پیش‌فروش", value: 9000000000 },
    ]);
    expect(propertyFilePriceParts({ salePrice: "9000000000", dealTypeName: "sale" })).toEqual([
      { label: "قیمت فروش", value: 9000000000 },
    ]);
  });
});

describe("propertyFileInquiryValidationError", () => {
  it("accepts a client name without a note", () => {
    expect(
      propertyFileInquiryValidationError({ ...EMPTY_PROPERTY_FILE_INQUIRY, clientName: "سارا احمدی" })
    ).toBeNull();
  });

  it("accepts a note without a client name", () => {
    expect(
      propertyFileInquiryValidationError({ ...EMPTY_PROPERTY_FILE_INQUIRY, message: "هماهنگی بازدید" })
    ).toBeNull();
  });

  it("rejects whitespace only input", () => {
    expect(propertyFileInquiryValidationError({ clientName: "  ", clientPhone: "0912", message: "\n " })).toBe(
      "نام مشتری یا متن یادداشت را وارد کنید."
    );
    expect(propertyFileInquiryValidationError(EMPTY_PROPERTY_FILE_INQUIRY)).toBe(
      "نام مشتری یا متن یادداشت را وارد کنید."
    );
  });
});

describe("buildPropertyFileInquiryPayload", () => {
  it("trims every field for the ticket endpoint", () => {
    expect(
      buildPropertyFileInquiryPayload(42, {
        clientName: "  سارا احمدی ",
        clientPhone: " 09121112233 ",
        message: " برای بازدید حضوری هماهنگ کنید. ",
      })
    ).toEqual({
      propertyFileId: 42,
      clientName: "سارا احمدی",
      clientPhone: "09121112233",
      message: "برای بازدید حضوری هماهنگ کنید.",
    });
  });

  it("keeps the propertyFile id untouched", () => {
    expect(buildPropertyFileInquiryPayload("17", EMPTY_PROPERTY_FILE_INQUIRY).propertyFileId).toBe("17");
  });
});

describe("consultantInitials", () => {
  it("builds up to two letters from the consultant name", () => {
    expect(consultantInitials("مینا کریمی")).toBe("مک");
    expect(consultantInitials("رضا مرادی پور")).toBe("رم");
    expect(consultantInitials("سارا")).toBe("س");
  });

  it("falls back for missing names", () => {
    expect(consultantInitials("")).toBe("؟");
    expect(consultantInitials(null)).toBe("؟");
    expect(consultantInitials("   ")).toBe("؟");
  });
});

describe("propertyFile channel labels", () => {
  it("covers every publish channel", () => {
    PROPERTY_FILE_CHANNEL_CODES.forEach((code) => {
      const label = toPersianChannel(code);
      expect(label).toBeTruthy();
      expect(label).not.toBe(code);
      expect(label).not.toBe("—");
    });
  });

  it("ignores an unknown channel", () => {
    expect(toPersianChannel("")).toBe("—");
    expect(toPersianChannel(null)).toBe("—");
  });
});
describe("matchDealKind", () => {
  const dealTypes = [
    { id: 1, displayName: "فروش", name: "sale" },
    { id: 2, displayName: "رهن و اجاره", name: "rent" },
    { id: 3, displayName: "رهن کامل", name: "mortgage" },
  ];

  it("derives the budget shape from the selected deal type", () => {
    expect(matchDealKind("1", dealTypes)).toBe("sale");
    expect(matchDealKind("2", dealTypes)).toBe("rent");
    expect(matchDealKind("3", dealTypes)).toBe("mortgage");
  });

  it("falls back to a free brief without a known deal type", () => {
    expect(matchDealKind("", dealTypes)).toBe("all");
    expect(matchDealKind("99", dealTypes)).toBe("all");
  });
});

describe("matchBriefToCriteria", () => {
  it("turns a million based brief into engine criteria", () => {
    expect(
      matchBriefToCriteria({
        ...EMPTY_MATCH_BRIEF,
        dealType: "2",
        propertyTypeRef: "5",
        saleMaxMillion: "۱۲۰۰۰",
        depositMaxMillion: " ۵۰۰ ",
        rentMaxMillion: "۳۰",
        areaMin: "۸۰",
        areaMax: "۱۲۰",
        city: " تهران ",
        district: "سعادت‌آباد",
      })
    ).toEqual({
      q: "",
      dealType: "2",
      propertyTypeRef: "5",
      city: "تهران",
      district: "سعادت‌آباد",
      areaMin: "80",
      areaMax: "120",
      saleMax: "12000000000",
      depositMax: "500000000",
      rentMax: "30000000",
    });
  });

  it("keeps every empty answer empty", () => {
    expect(matchBriefToCriteria(EMPTY_MATCH_BRIEF)).toEqual(EMPTY_PROPERTY_FILE_MATCH_CRITERIA);
  });
});

describe("matchCriteriaBudgetText", () => {
  it("summarizes each ceiling in Persian", () => {
    expect(
      matchCriteriaBudgetText({
        ...EMPTY_PROPERTY_FILE_MATCH_CRITERIA,
        saleMax: "12000000000",
        depositMax: "500000000",
      })
    ).toBe("سقف خرید ۱۲ میلیارد تومان · سقف ودیعه ۵۰۰ میلیون تومان");
  });
});

describe("buildMatchEngineParams", () => {
  const criteria = {
    ...EMPTY_PROPERTY_FILE_MATCH_CRITERIA,
    dealType: "2",
    city: "تهران",
    district: "سعادت‌آباد",
    areaMin: "100",
    areaMax: "120",
    saleMax: "10000000000",
    depositMax: "500000000",
    rentMax: "30000000",
  };

  it("widens the soft bounds around the brief", () => {
    const params = buildMatchEngineParams(criteria, 1, 100, false);
    expect(params.get("areaMin")).toBe("85");
    expect(params.get("areaMax")).toBe("138");
    expect(params.get("saleMax")).toBe("11500000000");
    expect(params.get("depositMax")).toBe("575000000");
    expect(params.get("rentMax")).toBe("34500000");
    expect(params.get("page")).toBe("1");
    expect(params.get("page_size")).toBe("100");
    expect(params.has("scope")).toBe(false);
  });

  it("keeps the district for the engine only when no city is set", () => {
    expect(buildMatchEngineParams(criteria, 1, 100, false).has("district")).toBe(false);
    expect(buildMatchEngineParams({ ...criteria, city: "" }, 1, 100, false).get("district")).toBe(
      "سعادت‌آباد"
    );
  });

  it("builds a nearby area band from a single bound", () => {
    const lower = buildMatchEngineParams(
      { ...EMPTY_PROPERTY_FILE_MATCH_CRITERIA, areaMin: "100" },
      1,
      12,
      true
    );
    expect(lower.get("areaMin")).toBe("90");
    expect(lower.get("areaMax")).toBe("180");
    expect(lower.get("scope")).toBe("mine");
    const upper = buildMatchEngineParams(
      { ...EMPTY_PROPERTY_FILE_MATCH_CRITERIA, areaMax: "100" },
      1,
      12,
      false
    );
    expect(upper.get("areaMin")).toBe("60");
    expect(upper.get("areaMax")).toBe("115");
  });

  it("drops blank criteria", () => {
    const params = buildMatchEngineParams(EMPTY_PROPERTY_FILE_MATCH_CRITERIA, 1, 12, false);
    expect([...params.keys()]).toEqual(["page", "page_size"]);
  });
});

describe("scorePropertyFileMatch", () => {
  const criteria = {
    ...EMPTY_PROPERTY_FILE_MATCH_CRITERIA,
    city: "تهران",
    district: "سعادت‌آباد",
    areaMin: "100",
    areaMax: "120",
    saleMax: "10000000000",
  };

  const candidate = {
    area: 110,
    city: "تهران",
    district: "سعادت‌آباد",
    salePrice: "5000000000",
  };

  it("scores a comfortable match with explicit reasons", () => {
    const result = scorePropertyFileMatch(candidate, criteria);
    expect(result.score).toBe(97);
    expect(result.reasons).toEqual([
      "بودجه با فضای کافی",
      "متراژ در بازهٔ درخواستی",
      "محلهٔ یکسان",
    ]);
  });

  it("lowers the score near the budget ceiling", () => {
    const result = scorePropertyFileMatch({ ...candidate, salePrice: "11000000000" }, criteria);
    expect(result.score).toBe(84);
    expect(result.reasons[0]).toBe("کمی بالاتر از بودجه");
  });

  it("keeps another district below an exact district match", () => {
    const other = scorePropertyFileMatch({ ...candidate, district: "پونک" }, criteria);
    expect(other.reasons).toContain("همان شهر، محلهٔ دیگر");
    expect(other.score).toBeLessThan(scorePropertyFileMatch(candidate, criteria).score);
  });

  it("penalizes a propertyFile outside the requested area band", () => {
    const small = scorePropertyFileMatch({ ...candidate, area: 60 }, criteria);
    expect(small.reasons).toContain("متراژ کمتر از درخواست");
    expect(small.score).toBeLessThan(scorePropertyFileMatch(candidate, criteria).score);
  });

  it("flags a negotiable price instead of guessing", () => {
    const result = scorePropertyFileMatch({ area: 110, city: "تهران", district: "سعادت‌آباد" }, criteria);
    expect(result.reasons).toContain("قیمت توافقی");
  });

  it("falls back to a neutral score for an empty brief", () => {
    expect(scorePropertyFileMatch(candidate, EMPTY_PROPERTY_FILE_MATCH_CRITERIA)).toEqual({
      score: 72,
      reasons: ["نزدیک‌ترین گزینه به درخواست"],
    });
  });

  it("stays inside the zero to hundred range", () => {
    const extreme = scorePropertyFileMatch({ ...candidate, area: 5, salePrice: "90000000000" }, criteria);
    expect(extreme.score).toBeGreaterThanOrEqual(0);
    expect(extreme.score).toBeLessThanOrEqual(100);
  });
});

describe("rankPropertyFileMatches", () => {
  it("sorts the strongest matches first", () => {
    const criteria = {
      ...EMPTY_PROPERTY_FILE_MATCH_CRITERIA,
      city: "تهران",
      district: "سعادت‌آباد",
      areaMin: "100",
      areaMax: "120",
      saleMax: "10000000000",
    };
    const base = {
      area: 110,
      city: "تهران",
      district: "سعادت‌آباد",
    };
    const ranked = rankPropertyFileMatches(
      [
        { id: 1, ...base, salePrice: "11000000000" },
        { id: 2, ...base, salePrice: "5000000000" },
        { id: 3, ...base, district: "پونک", salePrice: "5000000000" },
      ],
      criteria
    );
    expect(ranked.map((entry) => entry.propertyFile.id)).toEqual([2, 3, 1]);
  });
});
