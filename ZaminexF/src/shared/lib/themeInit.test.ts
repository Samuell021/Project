import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve(process.cwd(), "../ZaminexB/static/js/theme-init.js");
const script = readFileSync(scriptPath, "utf-8");

type StoredValue = string | null;

function runFirstPaint(saved: StoredValue, prefersDark: boolean) {
  const classes = new Set<string>();
    const documentElement = {
      dataset: { brandTheme: "" },
      classList: {
      toggle: (name: string, value: boolean) => {
        if (value) classes.add(name);
        else classes.delete(name);
      },
    },
    style: {} as Record<string, string>,
  };
  const storage: Record<string, string> = {};
  if (saved !== null) storage["zaminex-theme"] = saved;
  const window = {
    localStorage: {
      getItem: (key: string) => storage[key] ?? null,
    },
    matchMedia: () => ({ matches: prefersDark }),
  };
  const factory = new Function("window", "document", script) as (
    scope: typeof window,
    scopeDocument: { documentElement: typeof documentElement },
  ) => void;
  const document = { documentElement, querySelector: () => ({ setAttribute: () => {} }) };
  factory(window, document);
  return { dark: classes.has("dark"), colorScheme: documentElement.style.colorScheme };
}

describe("first paint theme bootstrap", () => {
  it("follows the operating system when nothing is stored", () => {
    expect(runFirstPaint(null, true)).toEqual({ dark: true, colorScheme: "dark" });
    expect(runFirstPaint(null, false)).toEqual({ dark: false, colorScheme: "light" });
  });

  it("follows the operating system when the saved mode is system", () => {
    expect(runFirstPaint("system", true)).toEqual({ dark: true, colorScheme: "dark" });
    expect(runFirstPaint("system", false)).toEqual({ dark: false, colorScheme: "light" });
  });

  it("honours a manual dark choice even when the system prefers light", () => {
    expect(runFirstPaint("dark", false)).toEqual({ dark: true, colorScheme: "dark" });
  });

  it("honours a manual light choice even when the system prefers dark", () => {
    expect(runFirstPaint("light", true)).toEqual({ dark: false, colorScheme: "light" });
  });

  it("falls back to the system preference for unknown values", () => {
    expect(runFirstPaint("", true)).toEqual({ dark: true, colorScheme: "dark" });
    expect(runFirstPaint("blue", false)).toEqual({ dark: false, colorScheme: "light" });
  });

  it("shares the persisted storage key with the application", () => {
    expect(script).toContain("zaminex-theme");
  });
});
