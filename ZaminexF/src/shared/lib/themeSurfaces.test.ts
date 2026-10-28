import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(process.cwd(), "src");
const neutralHues = ["slate", "gray", "zinc", "neutral", "stone"];

function sourceFiles(directory = sourceRoot): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) return [];
    return [full];
  });
}

function quotedStrings(content: string): string[] {
  const strings: string[] = [];
  let current = "";
  let open: string | null = null;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (open) {
      if (char === "\\") {
        current += content[index + 1] ?? "";
        index += 1;
        continue;
      }
      if (char === open) {
        strings.push(current);
        current = "";
        open = null;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "`" || char === "'") {
      open = char;
      current = "";
    }
  }
  return strings;
}

const files = sourceFiles().map((file) => ({
  path: path.relative(sourceRoot, file).split(path.sep).join("/"),
  content: readFileSync(file, "utf-8"),
}));

const classStrings = files.flatMap((file) =>
  quotedStrings(file.content).map((value) => ({ path: file.path, value })),
);

function darkCounterparts(kind: string, hue: string, variant: string): string[] {
  const prefix = variant ? `dark:${variant}:` : "dark:";
  return [`${prefix}${kind}-${hue}-500/`, `${prefix}${kind}-${hue}-400/`];
}

function checkLiteralSurfaces(): string[] {
  const offenders: string[] = [];
  for (const { path: filePath, value } of classStrings) {
    for (const match of value.matchAll(
      /(?<!dark:)(?:(hover|focus|focus-visible|group-hover|active):)?(bg|border)-([a-z]+)-(50|100|200)(?![\w-])/g,
    )) {
      const hue = match[3];
      if (neutralHues.includes(hue)) continue;
      const tail = value.slice(match.index ?? 0);
      const candidates = darkCounterparts(match[2], hue, match[1] ?? "");
      if (!candidates.some((candidate) => tail.includes(candidate))) {
        offenders.push(`${filePath}: ${match[0]}`);
      }
    }
  }
  return offenders;
}

function checkLiteralText(): string[] {
  const offenders: string[] = [];
  for (const { path: filePath, value } of classStrings) {
    for (const match of value.matchAll(
      /(?<!dark:)(?:(hover|focus|focus-visible|group-hover|active):)?text-([a-z]+)-(400|500|600|700|800|900)(?![\w-])/g,
    )) {
      const hue = match[2];
      if ([...neutralHues, "white", "black"].includes(hue)) continue;
      const tail = value.slice(match.index ?? 0);
      const prefix = match[1] ? `dark:${match[1]}:` : "dark:";
      if (!tail.includes(`${prefix}text-${hue}-`)) {
        offenders.push(`${filePath}: ${match[0]}`);
      }
    }
  }
  return offenders;
}

function checkHardcodedSurfaces(): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    for (const match of file.content.matchAll(/bg-white(?:\/(\d{1,3}))?/g)) {
      const alpha = match[1] ? Number(match[1]) : 100;
      if (alpha > 25) offenders.push(`${file.path}: ${match[0]}`);
    }
    for (const match of file.content.matchAll(
      /(?<![\w-])(?:bg|border|divide|text)-(?:slate|gray)-(?:50|100|200|300|400|500)(?![\w-])/g,
    )) {
      offenders.push(`${file.path}: ${match[0]}`);
    }
  }
  return offenders;
}

describe("theme aware colors", () => {
  it("never hardcodes light surfaces without a token", () => {
    expect(checkHardcodedSurfaces()).toEqual([]);
  });

  it("gives every soft chip surface a dark counterpart", () => {
    expect(checkLiteralSurfaces()).toEqual([]);
  });

  it("gives every colored text accent a dark counterpart", () => {
    expect(checkLiteralText()).toEqual([]);
  });

  it("keeps white text inside brand fills on a theme token", () => {
    const offenders = classStrings
      .filter(({ value }) => /(?<![\w-])text-white(?![\w-])/.test(value))
      .filter(({ value }) => /(?<![\w-])bg-primary(?![\w-])/.test(value))
      .map(({ path: filePath, value }) => `${filePath}: ${value.slice(0, 80)}`);
    expect(offenders).toEqual([]);
  });

  it("routes decorative gradients through theme tokens", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const match of file.content.matchAll(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g)) {
        const token = match[0];
        const line = file.content.slice(0, match.index ?? 0).split("\n").pop() ?? "";
        if (!line.includes("gradient")) continue;
        if (line.includes("drop-shadow") || line.includes("boxShadow")) continue;
        if (/var\(--/.test(token) || /color-mix/.test(token)) continue;
        offenders.push(`${file.path}: ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("theme switch wiring", () => {
  it.each([
    "features/auth/TopBar.tsx",
    "features/auth/LoginPage.tsx",
    "features/propertyFiles/pages/PublicPropertyFilesPage.tsx",
    "features/propertyFiles/pages/PublicPropertyFileDetailPage.tsx",
  ])("offers the switch on %s", (relativePath) => {
    const content = readFileSync(path.resolve(sourceRoot, relativePath), "utf-8");
    expect(content).toContain("shared/components/ThemeModeSwitch");
    expect(content).toContain("<ThemeModeSwitch");
  });

  it("no longer forces a single theme on the application shell", () => {
    expect(readFileSync(path.resolve(sourceRoot, "main.tsx"), "utf-8")).not.toContain("forcedTheme");
    expect(
      readFileSync(path.resolve(sourceRoot, "shared/components/AppThemeProvider.tsx"), "utf-8"),
    ).not.toContain("forcedTheme");
    expect(readFileSync(path.resolve(sourceRoot, "main.tsx"), "utf-8")).toContain(
      "applySavedThemePreference(initialData.brandTheme);",
    );
  });

  it("routes chart colors through theme tokens", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const match of file.content.matchAll(/(?:stroke|fill|stopColor)="#[0-9a-fA-F]{3,8}"/g)) {
        offenders.push(`${file.path}: ${match[0]}`);
      }
      for (const match of file.content.matchAll(/contentStyle=\{\{[^}]*#[0-9a-fA-F]{3,8}[^}]*\}\}/g)) {
        offenders.push(`${file.path}: ${match[0]}`);
      }
      for (const match of file.content.matchAll(/backgroundColor:\s*"#[0-9a-fA-F]{3,8}"/g)) {
        offenders.push(`${file.path}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("mounts every application surface inside the theme provider", () => {
    const main = readFileSync(path.resolve(sourceRoot, "main.tsx"), "utf-8");
    const roots = main.match(/createRoot\(/g)?.length ?? 0;
    const providers = main.match(/<AppThemeProvider>/g)?.length ?? 0;
    expect(roots).toBeGreaterThan(0);
    expect(providers).toBe(roots);
  });

  it("keeps the pre-hydration script in sync with the storage key", () => {
    const preHydration = readFileSync(
      path.resolve(process.cwd(), "../ZaminexB/static/js/theme-init.js"),
      "utf-8",
    );
    expect(preHydration).toContain("zaminex-theme");
    expect(preHydration).toContain("dark");
    expect(preHydration).toContain("light");
  });
});
