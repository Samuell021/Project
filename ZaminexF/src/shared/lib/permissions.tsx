import React, { createContext, useContext, useMemo } from "react";

import type { Page, Role } from "./types";

export type PermissionCode =
  | "staff.manage"
  | "property.create"
  | "property.edit"
  | "property.archive"
  | "property.delete"
  | "property.assign"
  | "property.review"
  | "property.export"
  | "property.appraisal"
  | "property_file.create"
  | "property_file.edit"
  | "property_file.assign"
  | "property_file.review"
  | "property_file.status"
  | "followup.manage"
  | "task.manage"
  | "consultant.manage"
  | "consultant.analytics"
  | "ticket.view_all"
  | "ticket.export"
  | "activity.view"
  | "activity.delete"
  | "analytics.view"
  | "company.edit"
  | "basics.manage"
  | "login.settings"
  | "profile.edit"
  | "contact.view" | "contact.manage" | "case.view" | "case.create" | "case.accept_lead" | "case.assign" | "case.appraise" | "property.review_decide" | "inquiry.view" | "inquiry.manage" | "introduction.manage" | "viewing.manage" | "deal.manage" | "pipeline.view" | "scope.manage" | "dealtype.manage" | "contract.manage" | "finance.view" | "finance.manage" | "finance.policy";

export const ALL_PERMISSION_CODES: PermissionCode[] = [
  "staff.manage",
  "property.create",
  "property.edit",
  "property.archive",
  "property.delete",
  "property.assign",
  "property.review",
  "property.export",
  "property.appraisal",
  "property_file.create",
  "property_file.edit",
  "property_file.assign",
  "property_file.review",
  "property_file.status",
  "followup.manage",
  "task.manage",
  "consultant.manage",
  "consultant.analytics",
  "ticket.view_all",
  "ticket.export",
  "activity.view",
  "activity.delete",
  "analytics.view",
  "company.edit",
  "basics.manage",
  "login.settings",
  "profile.edit",
  "contact.view", "contact.manage", "case.view", "case.create", "case.accept_lead", "case.assign", "case.appraise", "property.review_decide", "inquiry.view", "inquiry.manage", "introduction.manage", "viewing.manage", "deal.manage", "pipeline.view", "scope.manage", "dealtype.manage", "contract.manage", "finance.view", "finance.manage", "finance.policy",
];

const PAGE_PERMISSIONS: Partial<Record<Page, PermissionCode[]>> = {
  "admin-dashboard": ["analytics.view"],
  "add-property": ["property.create", "case.create"],
  "edit-property": ["property.edit"],
  "create-property-file": ["property_file.create"],
  "edit-property-file": ["property_file.edit"],
  "create-task": ["task.manage"],
  "create-followup": ["followup.manage"],
  "tickets-all": ["ticket.view_all"],
  consultants: ["staff.manage", "consultant.manage"],
  "add-consultant": ["consultant.manage"],
  "edit-consultant": ["consultant.manage"],
  activity: ["activity.view"],
  "manage-districts": ["basics.manage"],
  "manage-attributes": ["basics.manage"],
  "settings-login-options": ["login.settings"],
  "crm-dashboard": ["analytics.view"],
  "crm-inbox": ["case.view", "inquiry.view"],
  "crm-contacts": ["contact.view"],
  "crm-property-register": ["property.create", "case.create"],
  "crm-property-cases": ["case.view"],
  "crm-reviews": ["property.review_decide", "property.review"],
  "crm-inquiries": ["inquiry.view"],
  "crm-inquiry-register": ["inquiry.view"],
  "crm-introductions": ["introduction.manage"],
  "crm-viewings": ["viewing.manage"],
  "crm-pipelines": ["pipeline.view"],
  "crm-explore": ["pipeline.view"],
  "crm-deals": ["introduction.manage", "viewing.manage", "deal.manage", "pipeline.view"],
  "crm-contracts": ["contract.manage"],
  "crm-finance": ["finance.view"],
  "crm-deal-types": ["dealtype.manage"],
  "crm-reports": ["analytics.view", "finance.view"],
  "my-profile-edit": ["profile.edit"],
  "my-profile-security": ["profile.edit"],
};

export function roleLabel(role?: Role | null): string {
  if (role === "admin") return "مدیر";
  if (role === "range_manager") return "مدیر رنج";
  if (role === "finance") return "مالی";
  return "کارشناس";
}

export function userRoleLabel(code?: string | null): string {
  if (code === "ADMIN") return "مدیر";
  if (code === "RANGE_MANAGER") return "مدیر رنج";
  if (code === "AGENT") return "کارشناس";
  if (code === "FINANCE") return "مالی";
  return code || "";
}

export function isStaffRole(role?: Role | null): boolean {
  return role === "admin" || role === "range_manager";
}

export function pageIsAllowed(
  page: Page,
  role: Role,
  permissions?: string[] | null,
): boolean {
  // «کاریز عملیات» opens for the admin and for a consultant, whose board the server scopes to
  // that consultant's own records. Range managers and finance are refused, and no permission
  // set can widen it. The App guard reads this too, so a hand-typed URL redirects those roles
  // to their own page.
  if (page === "crm-settings") return role === "admin";
  if (page === "crm-pipelines") return role === "admin" || role === "consultant";
  if (role === "finance" && (page === "crm-contracts" || page === "activity")) return true;
  if (page === "crm-reviews") {
    if (role !== "admin" && role !== "range_manager") return false;
    if (role === "admin" || !permissions) return true;
    return permissions.includes("property.review_decide") || permissions.includes("property.review") || permissions.includes("scope.manage");
  }
  if (role === "admin") return true;
  if (!permissions) return true;
  const required = PAGE_PERMISSIONS[page];
  if (!required) return true;
  return required.some((code) => permissions.includes(code));
}

type PermissionContextValue = {
  permissions: string[] | null;
  can: (code: PermissionCode) => boolean;
};

const PermissionContext = createContext<PermissionContextValue>({
  permissions: null,
  can: () => true,
});

export function PermissionProvider({
  permissions,
  children,
}: {
  permissions: string[] | null;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({
      permissions,
      can: (code: PermissionCode) =>
        !permissions || permissions.includes(code),
    }),
    [permissions],
  );
  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermissions(): PermissionContextValue {
  return useContext(PermissionContext);
}
