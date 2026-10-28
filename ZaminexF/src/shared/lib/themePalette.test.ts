import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const themeCss = readFileSync(path.resolve(process.cwd(), "src/styles/theme.css"), "utf-8");

function block(selector: string): string {
  const start = themeCss.indexOf(`${selector} {`);
  expect(start, `${selector} block is missing`).toBeGreaterThan(-1);
  const end = themeCss.indexOf("}", start);
  return themeCss.slice(start, end);
}

function token(selector: string, name: string): string {
  const match = block(selector).match(new RegExp(`--${name}:\\s*([^;]+);`));
  expect(match, `--${name} is missing in ${selector}`).not.toBeNull();
  return (match as RegExpMatchArray)[1].trim();
}

function luminance(color: string): number {
  const hex = color.replace("#", "");
  const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

const lightTokens = {
  background: "#f2f4f8",
  foreground: "#111827",
  card: "#ffffff",
  primary: "#0bb68a",
  "muted-foreground": "#6b7280",
};

const darkTokens = {
  background: "#0c1524",
  foreground: "#e9eff8",
  "foreground-soft": "#c9d5e6",
  card: "#141f33",
  popover: "#18243a",
  primary: "#2ad3a6",
  "primary-foreground": "#06231b",
  secondary: "#1e2a3e",
  secondary_foreground: "#dce6f3",
  "muted-foreground": "#a6b6cc",
  "surface-subtle": "#182338",
  "surface-muted": "#1e2a3e",
  "border-strong": "#303f5a",
  destructive: "#f87171",
};

describe("light palette", () => {
  it.each(Object.entries(lightTokens))("keeps the original --%s", (name, value) => {
    expect(token(":root", name)).toBe(value);
  });

  it("keeps the light surface and text separation readable", () => {
    expect(contrast("#111827", "#ffffff")).toBeGreaterThan(12);
    expect(contrast("#6b7280", "#ffffff")).toBeGreaterThan(4.5);
    expect(contrast("#334155", "#f1f5f9")).toBeGreaterThan(7);
  });
});

describe("dark palette", () => {
  it.each(Object.entries(darkTokens))("defines --%s", (name, value) => {
    const cssName = name === "secondary_foreground" ? "secondary-foreground" : name;
    expect(token(".dark", cssName).toLowerCase()).toBe(value);
  });

  it("declares the class based dark variant for the document root and its content", () => {
    expect(themeCss).toContain("@custom-variant dark (&:where(.dark, .dark *))");
  });

  it("keeps the primary text readable on both dark surfaces", () => {
    expect(contrast(darkTokens.foreground, darkTokens.card)).toBeGreaterThan(12);
    expect(contrast(darkTokens.foreground, darkTokens.background)).toBeGreaterThan(12);
    expect(contrast(darkTokens["foreground-soft"], darkTokens.card)).toBeGreaterThan(9);
    expect(contrast(darkTokens["muted-foreground"], darkTokens.card)).toBeGreaterThan(6);
    expect(contrast(darkTokens["muted-foreground"], darkTokens.background)).toBeGreaterThan(6);
  });

  it("keeps the brand accent readable as text and as a button fill", () => {
    expect(contrast(darkTokens.primary, darkTokens.card)).toBeGreaterThan(6);
    expect(contrast(darkTokens.primary, darkTokens.background)).toBeGreaterThan(6);
    expect(contrast(darkTokens["primary-foreground"], darkTokens.primary)).toBeGreaterThan(6);
  });

  it("keeps the secondary and destructive surfaces readable", () => {
    expect(contrast(darkTokens.secondary_foreground, darkTokens.secondary)).toBeGreaterThan(9);
    expect(contrast(darkTokens.destructive, darkTokens.card)).toBeGreaterThan(4.5);
    expect(contrast(darkTokens.popover, darkTokens.background)).toBeGreaterThan(1.05);
    expect(contrast(darkTokens.card, darkTokens.background)).toBeGreaterThan(1.05);
    expect(contrast(darkTokens["border-strong"], darkTokens.card)).toBeGreaterThan(1.3);
  });

  it("keeps the sidebar readable", () => {
    expect(contrast("#ffffff", token(".dark", "sidebar"))).toBeGreaterThan(12);
  });
});

describe("theme implementation", () => {
  it("does not fall back to overriding utility classes", () => {
    expect(themeCss).not.toMatch(/\.dark\s+\.(bg|text|border|from|to)-/);
  });

  it("reserves important flags for third party widgets", () => {
    const important = themeCss.match(/!important/g) ?? [];
    expect(important.length).toBeLessThanOrEqual(8);
  });

  it("ships the mode switch styling used by the header control", () => {
    expect(themeCss).toContain(".theme-mode-switch");
    expect(themeCss).toContain('.theme-mode-switch__option[aria-checked="true"]');
    expect(themeCss).not.toContain(".theme-mode-switch--compact");
    expect(themeCss).not.toContain(".theme-mode-switch__label");
    expect(block(".theme-mode-switch__option")).toContain("width: 30px");
    expect(block(".theme-mode-switch__option")).toContain("height: 30px");
    expect(block(".theme-mode-switch__option:focus-visible")).toContain("outline: 2px solid var(--theme-switch-accent)");
  });
});

describe("theme switch icon contrast", () => {
  it.each([":root", ".dark"])("keeps selected icons, borders and focus visible in %s", (selector) => {
    const accent = token(selector, "theme-switch-accent");
    expect(contrast(accent, token(selector, "card"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(accent, token(selector, "surface-muted"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token(selector, "muted-foreground"), token(selector, "surface-muted"))).toBeGreaterThanOrEqual(3);
    expect(block('.theme-mode-switch__option[aria-checked="true"]')).toContain("border-color: var(--theme-switch-accent)");
    expect(block('.theme-mode-switch__option[aria-checked="true"] svg')).toContain("color: var(--theme-switch-accent)");
  });
});
