import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TopBar } from "./TopBar";

const source = readFileSync(path.resolve(process.cwd(), "src/features/auth/TopBar.tsx"), "utf8");

describe("top bar theme placement", () => {
  it("renders exactly one switch after the complete profile block", () => {
    expect(source.match(/<ThemeModeSwitch\b/g)?.length).toBe(1);
    expect(source.indexOf("<ThemeModeSwitch")).toBeGreaterThan(source.indexOf("<ProfileAvatar"));
    // Outside the identity cluster: the switch is the last child, so the RTL header puts it on the left.
    expect(source.indexOf("<ThemeModeSwitch")).toBeGreaterThan(source.indexOf("ml-auto"));
    expect(source).toMatch(/<ThemeModeSwitch \/>\s*<\/header>/);
    expect(source).not.toContain("sm:inline-flex");
    expect(source).not.toContain("sm:hidden");
    expect(source).not.toContain("compact");
  });

  it.each(["admin", "consultant"] as const)("keeps the switch leftmost in the RTL header for %s", (role) => {
    const html = renderToStaticMarkup(createElement(TopBar, {
      role,
      userName: "کاربر تست",
      onCmd: () => {},
      onNotif: () => {},
      notifOpen: false,
      unreadCount: 2,
    }));
    expect(html).toMatch(/^<header dir="rtl"/);
    expect(html.match(/role="radiogroup"/g)?.length).toBe(1);
    expect(html.indexOf('role="radiogroup"')).toBeGreaterThan(html.indexOf("کاربر تست"));
    // The identity cluster is pushed by `ml-auto`, so everything rendered after it sits at the left end
    // and the switch is the header's very last child.
    expect(html.indexOf('role="radiogroup"')).toBeGreaterThan(html.indexOf("ml-auto"));
    expect(html.slice(html.indexOf('role="radiogroup"'))).toMatch(/<\/div><\/header>$/);
    expect(html).toContain("lucide-bell");
    expect(html).toContain('aria-label="حالت رنگ"');
  });
});
