import type { Page, Role } from "./types";
import { getNavigationGroups, getSettingsEntries, PROFILE_ENTRIES } from "./navigation";
import { pageIsAllowed } from "./permissions";

export type NavPageItem = {
  page: Page;
  label: string;
  section: string;
  keywords?: string;
};

export function getRoleNavPages(role?: Role, permissions?: string[] | null): NavPageItem[] {
  const groups = getNavigationGroups(role, permissions).flatMap((group) => group.items.map((item) => ({
    page: item.page,
    label: item.label,
    section: group.heading,
    keywords: item.keywords,
  })));
  const grouped = new Set(groups.map((entry) => entry.page));
  const settings = getSettingsEntries(role, permissions)
    .filter((entry) => !grouped.has(entry.page))
    .map((entry) => ({
      page: entry.page,
      label: entry.label,
      section: "تنظیمات",
      keywords: entry.keywords,
    }));
  const profile = PROFILE_ENTRIES
    .filter((entry) => pageIsAllowed(entry.page, role || "consultant", permissions))
    .map((entry) => ({
      page: entry.page,
      label: entry.label,
      section: "پروفایل",
      keywords: entry.keywords,
    }));
  return [...groups, ...settings, ...profile];
}
