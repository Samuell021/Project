import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(process.cwd(), "src");
const assetsDirectory = path.resolve(process.cwd(), "../ZaminexB/static/frontend/assets");

function sourceFiles(directory = sourceRoot): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) return [];
    return [full];
  });
}

function builtAsset(extension: string): string {
  const name = readdirSync(assetsDirectory).find(
    (entry) => entry.startsWith("main-") && entry.endsWith(extension),
  );
  expect(name, `no built ${extension} asset found`).toBeTruthy();
  return readFileSync(path.join(assetsDirectory, name as string), "utf-8");
}

function escapeClassName(className: string): string {
  return className.replace(/[/:]/g, (char) => `\\${char}`);
}

const darkUtilities = Array.from(
  new Set(
    sourceFiles().flatMap((file) =>
      readFileSync(file, "utf-8").match(/dark:(?:[a-z-]+:)*[a-z-]+-\d+(?:\/\d+)?/g) ?? [],
    ),
  ),
).sort();

describe("built theme bundle", () => {
  it("ships the midnight dark palette", () => {
    const css = builtAsset(".css");
    expect(css).toContain("--background:#0c1524");
    expect(css).toContain("--foreground:#e9eff8");
    expect(css).toContain("--primary:#2ad3a6");
    expect(css).toContain("--muted-foreground:#a6b6cc");
  });

  it("ships the three state switch styling", () => {
    const css = builtAsset(".css");
    expect(css).toContain(".theme-mode-switch{");
    expect(css).toContain(".theme-mode-switch__option[aria-checked=true]");
    expect(css).toContain(".theme-mode-switch__option:focus-visible");
    expect(css).not.toContain(".theme-mode-switch__label");
    expect(css).not.toContain(".theme-mode-switch--compact");
  });

  it("compiles every dark utility used by the application", () => {
    const css = builtAsset(".css");
    expect(darkUtilities.length).toBeGreaterThan(30);
    const missing = darkUtilities.filter((utility) => !css.includes(`.${escapeClassName(utility)}`));
    expect(missing).toEqual([]);
  });

  it("keeps light only surface literals out of the bundle", () => {
    const css = builtAsset(".css");
    expect(css).not.toContain(".bg-white{");
    expect(css).not.toMatch(/\.(?:bg|text|border)-(?:slate|gray)-(?:50|100|200|300|400|500)[{,:]/);
  });

  it("binds the pre-hydration script to the persisted preference", () => {
    const script = readFileSync(path.resolve(process.cwd(), "../ZaminexB/static/js/theme-init.js"), "utf-8");
    const js = builtAsset(".js");
    expect(script).toContain("zaminex-theme");
    expect(js).toContain("zaminex-theme");
  });
});
