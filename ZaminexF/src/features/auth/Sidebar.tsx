import React, { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, LogOut, Settings, Zap } from "lucide-react";
import { cx } from "../../shared/lib/utils";
import { ProfileAvatar } from "../../shared/components/ui/ProfileAvatar";
import type { Page, Role } from "../../shared/lib/types";
import { roleLabel, usePermissions } from "../../shared/lib/permissions";
import { getNavigationGroups, isSettingsPage, navigationStorageKey, readExpandedGroups } from "../../shared/lib/navigation";
import type { NavigationGroupId } from "../../shared/lib/navigation";

type SidebarProps = {
  role: Role;
  page: Page;
  navigate: (page: Page) => void;
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  userName: string;
  userId?: string;
  userImageUrl?: string | null;
  onLogout: () => void;
  ticketUnreadCount?: number;
  pendingReviewCount?: number;
};

function loadExpanded(key: string): NavigationGroupId[] {
  try {
    return typeof window === "undefined" ? [] : readExpandedGroups(window.localStorage, key);
  } catch {
    return [];
  }
}

function itemMatchesPage(itemPage: Page, activePage: Page): boolean {
  return itemPage === activePage || (itemPage === "add-property" && activePage === "crm-property-register");
}

export function Sidebar({ role, page, navigate, collapsed, setCollapsed, userName, userId, userImageUrl, onLogout, ticketUnreadCount = 0, pendingReviewCount = 0 }: SidebarProps) {
  const { permissions } = usePermissions();
  const sections = getNavigationGroups(role, permissions);
  const storageKey = navigationStorageKey(userId || `${role}:${userName}`);
  const [expansion, setExpansion] = useState(() => ({ key: storageKey, groups: loadExpanded(storageKey) }));
  const expanded = expansion.key === storageKey ? expansion.groups : loadExpanded(storageKey);

  const toggle = (id: NavigationGroupId) => {
    const groups = expanded.includes(id) ? expanded.filter((value) => value !== id) : [...expanded, id];
    setExpansion({ key: storageKey, groups });
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(groups));
    } catch {
      return;
    }
  };

  return (
    <aside className={cx("flex flex-col h-full bg-sidebar transition-all duration-200 flex-shrink-0", collapsed ? "w-16" : "w-56")}>
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-sidebar-border h-14">
        <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center flex-shrink-0"><Zap size={14} className="text-primary-foreground" /></div>
        {!collapsed && <div className="flex-1 min-w-0"><span className="text-white font-bold text-sm tracking-tight">Zaminex</span><p className="text-white/35 text-xs leading-none">سیستم‌عامل املاک</p></div>}
        <button type="button" aria-label={collapsed ? "باز کردن سایدبار" : "جمع کردن سایدبار"} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)} className="mr-auto text-white/30 hover:text-white transition-colors">{collapsed ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}</button>
      </div>
      <nav aria-label="منوی اصلی" className="flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-0.5">
        {sections.map((section) => {
          const open = expanded.includes(section.id);
          const active = section.items.some((item) => itemMatchesPage(item.page, page));
          const Icon = section.icon;
          const panelId = `navigation-${section.id}`;
          return (
            <section key={section.id} className="mb-1">
              <button type="button" aria-label={section.heading} title={collapsed ? section.heading : undefined} aria-expanded={open && !collapsed} aria-controls={panelId}
                onClick={() => { if (collapsed) setCollapsed(false); if (collapsed && open) return; toggle(section.id); }}
                className={cx("w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-right transition-colors text-xs font-semibold", active ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white")}>
                <Icon size={16} />
                {!collapsed && <><span className="flex-1">{section.heading}</span><ChevronDown size={13} className={cx("transition-transform", open && "rotate-180")} /></>}
              </button>
              {/* Items sit one level below their group heading: the panel is inset by the width the
                  heading spends on its icon and gap, so labels line up under the heading text. */}
              <div id={panelId} hidden={collapsed || !open} className="flex flex-col gap-0.5 mt-1 pr-6">
                {section.items.map((item, index) => {
                  const isCurrent = itemMatchesPage(item.page, page);
                  return (
                    <React.Fragment key={item.page}>
                      {/* Every entry shares one padding, so the group reads as a single aligned column;
                          the thin divider keeps related entries together. */}
                      {item.separatorBefore && index > 0 ? <div role="separator" className="mx-1 my-1 border-t border-sidebar-border" /> : null}
                      <button type="button" aria-current={isCurrent ? "page" : undefined} onClick={() => navigate(item.page)}
                        className={cx("w-full flex items-center gap-2 px-3 py-2 rounded-lg text-right text-xs transition-colors", isCurrent ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white")}>
                        <span className="flex-1">{item.label}</span>
                        {item.page === "crm-reviews" && pendingReviewCount > 0 && <span aria-label="در انتظار تأیید" className="bg-amber-500/90 text-slate-950 font-bold px-1.5 py-0.5 rounded-full">{pendingReviewCount.toLocaleString("fa-IR")}</span>}
                        {item.page === "tickets-received" && ticketUnreadCount > 0 && <span aria-label="تیکت خوانده‌نشده" className="bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">{ticketUnreadCount.toLocaleString("fa-IR")}</span>}
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>
      <div className="p-3 border-t border-sidebar-border space-y-1">
        <button type="button" aria-label="تنظیمات" onClick={() => navigate("settings-workspace")}
          className={cx("w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors text-sm", isSettingsPage(page) ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white/90")}>
          <Settings size={15} />{!collapsed && <span className="font-medium">تنظیمات</span>}
        </button>
        <button type="button" aria-label="خروج" onClick={onLogout} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-white/55 hover:bg-white/5 hover:text-white/90 transition-colors text-sm"><LogOut size={15} />{!collapsed && <span className="font-medium">خروج</span>}</button>
        {!collapsed && <button type="button" onClick={() => navigate("my-profile")} className="w-full flex items-center gap-2.5 px-2.5 pt-2 mt-1 border-t border-sidebar-border text-right">
          <ProfileAvatar imageUrl={userImageUrl} initials={userName.split(" ").map((word) => word[0]).join("").slice(0, 2)} size="sm" />
          <span className="flex-1 min-w-0"><span className="block text-xs font-semibold text-white truncate">{userName}</span><span className="block text-xs text-white/35">{roleLabel(role)}</span></span>
        </button>}
      </div>
    </aside>
  );
}
