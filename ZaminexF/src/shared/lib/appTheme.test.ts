import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BRAND_THEMES,
  BRAND_THEME_STORAGE_KEY,
  THEME_MODES,
  THEME_STORAGE_KEY,
  applyBrandTheme,
  applySavedThemePreference,
  applyThemeMode,
  isBrandTheme,
  isThemeMode,
  nextThemeMode,
  readStoredThemeMode,
} from "./appTheme";

function stubDocument() {
  const toggle = vi.fn();
  const root = { classList: { toggle, contains: vi.fn(() => false) }, style: { colorScheme: "" }, dataset: { brandTheme: "" } };
  const meta = { setAttribute: vi.fn() };
  vi.stubGlobal("document", { documentElement: root, querySelector: vi.fn(() => meta) });
  return { toggle, root };
}

function stubWindow(savedTheme: string | null, prefersDark: boolean) {
  const getItem = vi.fn(() => savedTheme);
  vi.stubGlobal("window", {
    localStorage: { getItem },
    matchMedia: vi.fn(() => ({ matches: prefersDark })),
  });
  return { getItem };
}

describe("theme preference", () => {
  const storageKey = "zaminex-theme";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes the three selectable modes", () => {
    expect(THEME_MODES).toEqual(["light", "dark", "system"]);
    expect(THEME_STORAGE_KEY).toBe(storageKey);
  });

  it("uses the system preference when nothing has been saved yet", () => {
    const { toggle, root } = stubDocument();
    stubWindow(null, true);

    applySavedThemePreference();

    expect(toggle).toHaveBeenCalledWith("dark", true);
    expect(root.style.colorScheme).toBe("dark");
  });

  it("keeps a saved light preference when the system is dark", () => {
    const { toggle, root } = stubDocument();
    stubWindow("light", true);

    applySavedThemePreference();

    expect(toggle).toHaveBeenCalledWith("dark", false);
    expect(root.style.colorScheme).toBe("light");
  });

  it("keeps a saved dark preference when the system is light", () => {
    const { toggle, root } = stubDocument();
    stubWindow("dark", false);

    applySavedThemePreference();

    expect(toggle).toHaveBeenCalledWith("dark", true);
    expect(root.style.colorScheme).toBe("dark");
  });

  it("follows the system when the saved preference is the system mode", () => {
    const { toggle } = stubDocument();
    stubWindow("system", true);

    applySavedThemePreference();

    expect(toggle).toHaveBeenCalledWith("dark", true);
  });

  it("ignores an unknown saved value and falls back to the system mode", () => {
    const { toggle } = stubDocument();
    stubWindow("midnight", false);

    applySavedThemePreference();

    expect(toggle).toHaveBeenCalledWith("dark", false);
  });

  it("falls back to the system preference when local storage is unavailable", () => {
    const { toggle } = stubDocument();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => {
          throw new Error("Storage access denied");
        }),
      },
      matchMedia: vi.fn(() => ({ matches: true })),
    });

    expect(readStoredThemeMode()).toBe("system");

    applySavedThemePreference();

    expect(toggle).toHaveBeenCalledWith("dark", true);
  });

  it("survives a missing matchMedia implementation", () => {
    const { toggle, root } = stubDocument();
    vi.stubGlobal("window", {
      localStorage: { getItem: vi.fn(() => "system") },
    });

    expect(() => applySavedThemePreference()).not.toThrow();

    expect(toggle).toHaveBeenCalledWith("dark", false);
    expect(root.style.colorScheme).toBe("light");
  });

  it("applies an explicit mode without touching storage", () => {
    const { toggle, root } = stubDocument();
    stubWindow("light", false);

    applyThemeMode("dark");

    expect(toggle).toHaveBeenCalledWith("dark", true);
    expect(root.style.colorScheme).toBe("dark");
  });

  it("cycles through the modes for compact controls", () => {
    expect(nextThemeMode("light")).toBe("dark");
    expect(nextThemeMode("dark")).toBe("system");
    expect(nextThemeMode("system")).toBe("light");
  });

  it("exposes the six supported organization palettes", () => {
    expect(BRAND_THEMES.map(({ id }) => id)).toEqual(["green", "petroleum", "midnight", "plum", "copper", "slate"]);
    expect(BRAND_THEME_STORAGE_KEY).toBe("zaminex-brand-theme");
  });

  it("applies and persists an allowlisted organization palette", () => {
    const { root } = stubDocument();
    const setItem = vi.fn();
    vi.stubGlobal("window", { localStorage: { getItem: vi.fn(), setItem }, matchMedia: vi.fn(() => ({ matches: false })) });

    expect(applyBrandTheme("petroleum")).toBe("petroleum");
    expect(root.dataset.brandTheme).toBe("petroleum");
    expect(setItem).toHaveBeenCalledWith(BRAND_THEME_STORAGE_KEY, "petroleum");
    expect(isBrandTheme("petroleum")).toBe(true);
    expect(isBrandTheme("#ffffff")).toBe(false);
  });

  it("falls back to the safe default for invalid organization palettes", () => {
    const { root } = stubDocument();
    vi.stubGlobal("window", { localStorage: { getItem: vi.fn(), setItem: vi.fn() }, matchMedia: vi.fn(() => ({ matches: false })) });

    expect(applyBrandTheme("not-a-theme")).toBe("green");
    expect(root.dataset.brandTheme).toBe("green");
  });

  it("validates stored values", () => {
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("system")).toBe(true);
    expect(isThemeMode("auto")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
  });
});
