/**
 * Shape returned by `GET /crm/api/property-cases/{id}/assignable-staff/` (and the inquiry twin).
 *
 * The server resolves the list from the sales range itself — the same rule `assign_case` uses —
 * so the picker never shows somebody the API would reject and never comes back empty while an
 * assignment is still possible.
 */
export type AssignableStaffRow = {
  id: number | string;
  full_name?: string;
  role?: string;
  branch?: string;
  profile_image?: string | null;
};

/** The row shape `ConsultantCombobox` renders, so both pickers look and behave identically. */
export type AssignableStaffOption = {
  id: number | string;
  full_name: string;
  branch: string;
  profile_image: string | null;
  is_active: true;
  user: { id: number | string; role: string };
};

/** Deduplicated, trimmed options — one entry per account even if the server repeats a person. */
export function buildAssignableStaffOptions(rows: AssignableStaffRow[] | null | undefined): AssignableStaffOption[] {
  const seen = new Set<string>();
  const options: AssignableStaffOption[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    options.push({
      id: row.id,
      full_name: String(row.full_name || "").trim(),
      branch: String(row.branch || "").trim(),
      profile_image: row.profile_image || null,
      is_active: true,
      user: { id: row.id, role: String(row.role || "").toUpperCase() },
    });
  }
  return options;
}
