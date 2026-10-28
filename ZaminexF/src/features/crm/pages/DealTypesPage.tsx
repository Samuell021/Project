import { useMemo, useState } from "react";
import { useLoad } from "../lib/useCrmLoad";
import { post } from "../lib/crmApi";
import { usePageQuery } from "../../../shared/lib/pageQuery";
import { Shell, Card, Btn, Field, inputCls, SearchBar } from "../components/CrmUIKit";
import type { Row } from "../types";

type DealTypeVersionRow = {
  id: number;
  deal_type: number;
  deal_type_name: string;
  version_number: number;
  family: string;
  terms_schema: Record<string, unknown>;
  financial_fields: unknown[];
  required_roles: unknown[];
  rules: Record<string, unknown>;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  published_at: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "پیش‌نویس",
  PUBLISHED: "منتشرشده",
  ARCHIVED: "بایگانی‌شده",
};

const FAMILY_LABELS: Record<string, string> = {
  SALE: "فروش",
  RENT: "اجاره",
  FULL_MORTGAGE: "رهن کامل",
  PRE_SALE: "پیش‌فروش",
  PARTNERSHIP: "مشارکت در ساخت",
  EXCHANGE: "معاوضه",
};

function fa(value: string): string {
  return value.replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

function asVersions(rows: Row[]): DealTypeVersionRow[] {
  return rows.map((row) => ({
    id: Number(row.id),
    deal_type: Number(row.deal_type),
    deal_type_name: String(row.deal_type_name ?? ""),
    version_number: Number(row.version_number ?? 0),
    family: String(row.family ?? ""),
    terms_schema: (row.terms_schema ?? {}) as Record<string, unknown>,
    financial_fields: Array.isArray(row.financial_fields) ? row.financial_fields : [],
    required_roles: Array.isArray(row.required_roles) ? row.required_roles : [],
    rules: (row.rules ?? {}) as Record<string, unknown>,
    status: row.status === "PUBLISHED" || row.status === "ARCHIVED" ? row.status : "DRAFT",
    published_at: row.published_at ? String(row.published_at) : null,
  }));
}

function fieldNames(values: unknown[]): string {
  const names = values
    .map((value) => {
      if (typeof value === "string") return value;
      if (value && typeof value === "object" && "name" in value) return String((value as { name: unknown }).name);
      return "";
    })
    .filter(Boolean);
  return names.length ? names.join("، ") : "تعریف نشده";
}

export function DealTypes({ csrfToken, embedded = false }: { csrfToken: string; embedded?: boolean }) {
  const { query, update } = usePageQuery();
  const search = query.get("search") ?? "";
  const preview = query.get("preview") ?? "";
  const url = useMemo(() => `/crm/api/deal-type-versions/?search=${encodeURIComponent(search.trim())}`, [search]);
  const { data, error, loading, reload } = useLoad([url, "/basics/api/deal-types/"], csrfToken);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState("");

  const versions = asVersions(data[url] || []);
  const types: Row[] = data["/basics/api/deal-types/"] || [];

  async function run(action: string, targetUrl: string, body: Row = {}) {
    setBusy(action);
    setMessage(null);
    try {
      await post(csrfToken, targetUrl, body);
      setMessage({ tone: "success", text: "انجام شد." });
      reload();
    } catch (caught) {
      setMessage({ tone: "error", text: caught instanceof Error ? caught.message : "خطا در اجرای فرمان" });
    } finally {
      setBusy("");
    }
  }

  return (
    <Shell
      title="انواع معامله"
      subtitle="نسخه منتشرشده تغییر نمی‌کند؛ نوع تازه فقط روی شش خانواده رفتاری موجود ساخته می‌شود."
      error={error}
      loading={loading && !Object.keys(data).length}
      onReload={reload}
      embedded={embedded}
    >
      {message ? (
        <div role="status" className={`mb-4 rounded-xl px-4 py-3 text-sm ${message.tone === "error" ? "bg-red-50 text-red-700 dark:bg-red-500/12 dark:text-red-300" : "bg-surface-muted"}`}>
          {message.text}
        </div>
      ) : null}

      <SearchBar value={search} onChange={(value) => update({ search: value || null }, true)} placeholder="جست‌وجو بر اساس نوع معامله، وضعیت یا خانواده…" />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run("create-type", "/crm/api/deal-type-versions/create_deal_type/", {
                name: form.get("name"),
                display_name: form.get("display_name"),
                family: form.get("family"),
              });
            }}
            className="space-y-3"
          >
            <Field label="نام سیستمی"><input name="name" required dir="ltr" className={inputCls} /></Field>
            <Field label="نام نمایشی"><input name="display_name" required className={inputCls} /></Field>
            <Field label="خانواده">
              <select name="family" className={inputCls}>
                {Object.entries(FAMILY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Btn type="submit" disabled={busy === "create-type"}>ساخت نوع و نسخه اول</Btn>
          </form>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const dealType = Number(form.get("deal_type"));
              const latest = versions.filter((version) => version.deal_type === dealType).sort((a, b) => b.version_number - a.version_number)[0];
              void run("create-version", "/crm/api/deal-type-versions/", {
                deal_type: dealType,
                version_number: (latest?.version_number || 0) + 1,
                family: form.get("family"),
                financial_fields: latest?.financial_fields || [],
                required_roles: latest?.required_roles || [],
                rules: {},
              });
            }}
            className="mt-4 space-y-3 border-t border-border pt-3"
          >
            <Field label="نوع موجود">
              <select name="deal_type" className={inputCls} required>
                {types.map((type) => <option key={String(type.id)} value={String(type.id)}>{String(type.display_name ?? type.name ?? type.id)}</option>)}
              </select>
            </Field>
            <Field label="خانواده نسخه جدید">
              <select name="family" className={inputCls}>
                {Object.entries(FAMILY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Btn type="submit" color="light" disabled={busy === "create-version"}>ساخت نسخه پیش‌نویس</Btn>
          </form>
        </Card>

        <div className="space-y-3 lg:col-span-2">
          {versions.length === 0 && !loading ? <Card><p className="text-sm text-muted-foreground">نسخه‌ای با این جست‌وجو پیدا نشد.</p></Card> : null}
          {versions.map((version) => {
            const expanded = preview === String(version.id);
            return (
              <Card key={version.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{version.deal_type_name} · نسخه {fa(String(version.version_number))}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {FAMILY_LABELS[version.family] ?? version.family} · {STATUS_LABELS[version.status]}
                      {version.published_at ? " · منتشرشده" : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Btn
                      color="light"
                      ariaExpanded={expanded}
                      onClick={() => update({ preview: expanded ? null : String(version.id) })}
                    >
                      {expanded ? "بستن پیش‌نمایش" : "پیش‌نمایش"}
                    </Btn>
                    {version.status === "DRAFT" ? (
                      <Btn disabled={busy === `publish-${version.id}`} onClick={() => void run(`publish-${version.id}`, `/crm/api/deal-type-versions/${version.id}/publish/`)}>انتشار نسخه</Btn>
                    ) : null}
                    {version.status === "DRAFT" ? (
                      <Btn color="light" disabled={busy === `archive-${version.id}`} onClick={() => void run(`archive-${version.id}`, `/crm/api/deal-type-versions/${version.id}/archive/`)}>بایگانی پیش‌نویس</Btn>
                    ) : null}
                  </div>
                </div>
                {expanded ? (
                  <div className="mt-3 grid gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:grid-cols-2">
                    <p>فیلدهای مالی: {fieldNames(version.financial_fields)}</p>
                    <p>نقش‌های طرفین: {fieldNames(version.required_roles)}</p>
                    <p>خانواده رفتار: {FAMILY_LABELS[version.family] ?? version.family}</p>
                    <p>قواعد سفارشی: {Object.keys(version.rules).length ? Object.keys(version.rules).join("، ") : "ندارد"}</p>
                    <p className="sm:col-span-2">شرایط معامله: {Object.keys(version.terms_schema).length ? Object.keys(version.terms_schema).join("، ") : "پیش‌فرض خانواده"}</p>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
