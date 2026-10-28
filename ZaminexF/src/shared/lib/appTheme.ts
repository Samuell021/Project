type ThemeMode = "light" | "dark" | "system";
type BrandThemeId = "green" | "petroleum" | "midnight" | "plum" | "copper" | "slate";

type BrandThemeOption = {
  id: BrandThemeId;
  name: string;
  color: string;
};

const THEME_STORAGE_KEY = "zaminex-theme";
const BRAND_THEME_STORAGE_KEY = "zaminex-brand-theme";
const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];
const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  light: "روشن",
  dark: "تیره",
  system: "سیستم",
};
const THEME_MODE_DESCRIPTIONS: Record<ThemeMode, string> = {
  light: "پوسته روشن",
  dark: "پوسته تیره",
  system: "هماهنگ با تنظیمات سیستم‌عامل",
};
const BRAND_THEMES: BrandThemeOption[] = [
  { id: "green", name: "سبز فردا", color: "#176552" },
  { id: "petroleum", name: "آبی نفتی", color: "#164E63" },
  { id: "midnight", name: "آبی نیمه‌شب", color: "#191970" },
  { id: "plum", name: "آلویی", color: "#6B3D80" },
  { id: "copper", name: "مسی", color: "#92502F" },
  { id: "slate", name: "خاکستری‌آبی", color: "#475569" },
];
const BRAND_THEME_IDS = new Set<BrandThemeId>(BRAND_THEMES.map(({ id }) => id));

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

function isBrandTheme(value: unknown): value is BrandThemeId {
  return typeof value === "string" && BRAND_THEME_IDS.has(value as BrandThemeId);
}

function normalizeBrandTheme(value: unknown): BrandThemeId {
  return isBrandTheme(value) ? value : "green";
}

function readStoredThemeMode(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

function readStoredBrandTheme(): BrandThemeId {
  const serverTheme = typeof document !== "undefined"
    ? document.documentElement.dataset.brandTheme
    : undefined;
  if (isBrandTheme(serverTheme)) return serverTheme;

  try {
    return normalizeBrandTheme(window.localStorage.getItem(BRAND_THEME_STORAGE_KEY));
  } catch {
    return "green";
  }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function resolveIsDark(mode: ThemeMode, systemIsDark: boolean = systemPrefersDark()): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return systemIsDark;
}

function applyThemeMode(mode: ThemeMode) {
  const root = document.documentElement;
  const isDark = resolveIsDark(mode);
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
}

function applyBrandTheme(value: unknown) {
  const brandTheme = normalizeBrandTheme(value);
  const root = document.documentElement;
  root.dataset.brandTheme = brandTheme;

  try {
    window.localStorage.setItem(BRAND_THEME_STORAGE_KEY, brandTheme);
  } catch {
    // The server-provided palette remains active even if storage is unavailable.
  }

  const option = BRAND_THEMES.find(({ id }) => id === brandTheme) ?? BRAND_THEMES[0];
  const color = root.classList.contains("dark")
    ? ({ green: "#2ad3a6", petroleum: "#45b9d0", midnight: "#8990ff", plum: "#c89be0", copper: "#f0a777", slate: "#a9bfd4" } as const)[brandTheme]
    : option.color;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
  return brandTheme;
}

function applySavedThemePreference(brandTheme?: unknown) {
  applyThemeMode(readStoredThemeMode());
  applyBrandTheme(brandTheme ?? readStoredBrandTheme());
}

function nextThemeMode(mode: ThemeMode): ThemeMode {
  const index = THEME_MODES.indexOf(mode);
  return THEME_MODES[(index + 1) % THEME_MODES.length];
}

export {
  BRAND_THEMES,
  BRAND_THEME_STORAGE_KEY,
  THEME_MODE_DESCRIPTIONS,
  THEME_MODE_LABELS,
  THEME_MODES,
  THEME_STORAGE_KEY,
  applyBrandTheme,
  applySavedThemePreference,
  applyThemeMode,
  isBrandTheme,
  isThemeMode,
  nextThemeMode,
  normalizeBrandTheme,
  readStoredBrandTheme,
  readStoredThemeMode,
  resolveIsDark,
  systemPrefersDark,
};
export type { BrandThemeId, BrandThemeOption, ThemeMode };
