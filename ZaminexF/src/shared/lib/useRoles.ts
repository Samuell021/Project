import { useEffect, useState } from "react";
import { apiFetch } from "./apiClient";

export type AssignableRole = {
  code: string;
  name: string;
  isCustom: boolean;
};

const BASE_ASSIGNABLE_ROLES = ["AGENT", "RANGE_MANAGER"];

const FALLBACK_ROLES: AssignableRole[] = [
  { code: "AGENT", name: "کارشناس", isCustom: false },
  { code: "RANGE_MANAGER", name: "مدیر رنج", isCustom: false },
];

export const isBaseAssignableRole = (code: string) => BASE_ASSIGNABLE_ROLES.includes(code);

const isRoleRow = (
  row: unknown
): row is { code: string; name?: string; isCustom?: boolean } =>
  !!row && typeof row === "object" && typeof (row as { code?: unknown }).code === "string";

export function useAssignableRoles(csrfToken?: string) {
  const [roles, setRoles] = useState<AssignableRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(
          "/accounts/role-permissions/",
          { method: "GET" },
          csrfToken
        );
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { roles?: unknown };
        const rows = Array.isArray(data.roles) ? data.roles.filter(isRoleRow) : [];
        const options = rows
          .filter(
            (row) => BASE_ASSIGNABLE_ROLES.includes(row.code) || row.isCustom === true
          )
          .map((row) => ({
            code: row.code,
            name: row.name || row.code,
            isCustom: !BASE_ASSIGNABLE_ROLES.includes(row.code),
          }));
        if (!cancelled) setRoles(options);
      } catch {
        if (!cancelled) setRoles([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [csrfToken]);

  return { roles, loading };
}

export function roleSelectOptions(roles: AssignableRole[], isAdmin: boolean) {
  return (roles.length ? roles : FALLBACK_ROLES)
    .filter((role) => isAdmin || role.code === "AGENT")
    .map((role) => ({ label: role.name, value: role.code }));
}
