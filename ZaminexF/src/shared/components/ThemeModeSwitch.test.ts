import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeModeSwitch } from "./ThemeModeSwitch";

const render = (props: { className?: string } = {}) =>
  renderToStaticMarkup(createElement(ThemeModeSwitch, props));

describe("theme mode switch", () => {
  it("renders a labelled three state radio group", () => {
    const html = render();
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="حالت رنگ"');
    expect(html.match(/role="radio"/g)?.length).toBe(3);
    expect(html.replace(/<[^>]*>/g, "").trim()).toBe("");
    expect(html).not.toContain("theme-mode-switch__label");
  });

  it("marks exactly one option as checked", () => {
    const html = render();
    expect(html.match(/aria-checked="true"/g)?.length).toBe(1);
    expect(html.match(/aria-checked="false"/g)?.length).toBe(2);
    expect(html.match(/tabindex="0"/g)?.length).toBe(1);
    expect(html.match(/tabindex="-1"/g)?.length).toBe(2);
  });

  it("describes every option for assistive technology", () => {
    const html = render();
    expect(html).toContain('aria-label="پوسته روشن"');
    expect(html).toContain('aria-label="پوسته تیره"');
    expect(html).toContain('aria-label="هماهنگ با تنظیمات سیستم‌عامل"');
    for (const description of ["پوسته روشن", "پوسته تیره", "هماهنگ با تنظیمات سیستم‌عامل"]) {
      expect(html).toContain(`title="${description}"`);
    }
  });

  it("keeps the icons decorative", () => {
    const html = render();
    expect(html.match(/aria-hidden="true"/g)?.length).toBe(3);
    expect(html).toContain("lucide-sun");
    expect(html).toContain("lucide-moon");
    expect(html).toContain("lucide-monitor");
  });

  it("keeps custom classes without a separate labelled or compact variant", () => {
    const html = render({ className: "custom-switch" });
    expect(html).toContain("custom-switch");
    expect(html).not.toContain("theme-mode-switch--compact");
    expect(html.replace(/<[^>]*>/g, "").trim()).toBe("");
  });
});

describe("theme switch keyboard wiring", () => {
  it("supports RTL arrow keys and Home and End without extra tab stops", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/shared/components/ThemeModeSwitch.tsx"), "utf8");
    expect(source).toContain('dir="rtl"');
    expect(source).toContain("tabIndex={checked ? 0 : -1}");
    expect(source).toContain("onKeyDown={(event) => handleKeyDown(event, option)}");
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]) {
      expect(source).toContain(`event.key === "${key}"`);
    }
    expect(source).toContain("select(next)");
    expect(source).toContain("?.focus()");
  });
});
