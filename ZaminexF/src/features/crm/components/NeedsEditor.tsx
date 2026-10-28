import type { Row } from "../types";
import { Btn, Field, inputCls } from "./CrmUIKit";

type NeedsRow = {
  deal_type: string;
  min_amount: string;
  max_amount: string;
  max_deposit: string;
  max_monthly_rent: string;
  min_area: string;
  max_area: string;
  min_rooms: string;
  districts: string[];
  property_types: string[];
  required_conditions: Array<{ label: string; field: string; operator: string; value: string }>;
};

const CONDITION_FIELDS = [
  { value: "area", label: "متراژ" },
  { value: "rooms", label: "تعداد اتاق" },
  { value: "built_year", label: "سال ساخت" },
  { value: "floor", label: "طبقه" },
  { value: "sale_price", label: "مبلغ فروش" },
  { value: "deposit", label: "ودیعه" },
  { value: "monthly_rent", label: "اجاره ماهانه" },
];

const OPERATORS = [
  { value: "GTE", label: "بیشتر یا مساوی" },
  { value: "LTE", label: "کمتر یا مساوی" },
  { value: "EQ", label: "برابر" },
];

export function emptyNeedsRow(dealTypeId?: string | number | null): NeedsRow {
  return {
    deal_type: dealTypeId ? String(dealTypeId) : "",
    min_amount: "",
    max_amount: "",
    max_deposit: "",
    max_monthly_rent: "",
    min_area: "",
    max_area: "",
    min_rooms: "",
    districts: [],
    property_types: [],
    required_conditions: [],
  };
}

export function preferenceToNeedsRow(item: Row): NeedsRow {
  return {
    deal_type: String(item.deal_type || ""),
    min_amount: item.min_amount ?? "",
    max_amount: item.max_amount ?? "",
    max_deposit: item.max_deposit ?? "",
    max_monthly_rent: item.max_monthly_rent ?? "",
    min_area: item.min_area ?? "",
    max_area: item.max_area ?? "",
    min_rooms: item.criteria?.min_rooms ?? "",
    districts: (item.districts || []).map(String),
    property_types: (item.property_types || []).map(String),
    required_conditions: (item.criteria?.required || []).map((condition: Row) => ({
      label: String(condition.label || ""),
      field: String(condition.field || "area"),
      operator: String(condition.operator || "GTE"),
      value: condition.value === null || condition.value === undefined ? "" : String(condition.value),
    })),
  };
}

export function needsRowsPayload(rows: NeedsRow[]) {
  return rows.map((row) => ({
    deal_type: Number(row.deal_type),
    min_amount: row.min_amount === "" ? null : row.min_amount,
    max_amount: row.max_amount === "" ? null : row.max_amount,
    max_deposit: row.max_deposit === "" ? null : row.max_deposit,
    max_monthly_rent: row.max_monthly_rent === "" ? null : row.max_monthly_rent,
    min_area: row.min_area === "" ? null : Number(row.min_area),
    max_area: row.max_area === "" ? null : Number(row.max_area),
    min_rooms: row.min_rooms === "" ? null : Number(row.min_rooms),
    districts: row.districts.map(Number),
    property_types: row.property_types.map(Number),
    required_conditions: row.required_conditions
      .filter((condition) => condition.label.trim())
      .map((condition) => ({ ...condition, value: condition.value === "" ? null : condition.value })),
  }));
}

export function needsRowErrors(rows: NeedsRow[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (!row.deal_type) errors.push(`در ردیف ${index + 1} نوع معامله را انتخاب کنید.`);
    if (row.deal_type && seen.has(row.deal_type)) errors.push("برای هر نوع معامله فقط یک ردیف نیاز مجاز است.");
    seen.add(row.deal_type);
    if (row.min_amount && row.max_amount && Number(row.min_amount) > Number(row.max_amount)) errors.push("حداکثر بودجه نمی‌تواند از حداقل کمتر باشد.");
    if (row.min_area && row.max_area && Number(row.min_area) > Number(row.max_area)) errors.push("حداکثر متراژ نمی‌تواند از حداقل کمتر باشد.");
  });
  return errors;
}

export function NeedsEditor({
  rows,
  onChange,
  dealTypes,
  districts,
  propertyTypes,
}: {
  rows: NeedsRow[];
  onChange: (rows: NeedsRow[]) => void;
  dealTypes: Row[];
  districts: Row[];
  propertyTypes: Row[];
}) {
  function update(index: number, patch: Partial<NeedsRow>) {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function toggleList(index: number, key: "districts" | "property_types", value: string) {
    const current = rows[index][key];
    update(index, { [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] });
  }

  function updateCondition(index: number, conditionIndex: number, patch: Partial<NeedsRow["required_conditions"][number]>) {
    const next = rows[index].required_conditions.map((condition, itemIndex) => (itemIndex === conditionIndex ? { ...condition, ...patch } : condition));
    update(index, { required_conditions: next });
  }

  return (
    <div className="space-y-3">
      {rows.map((row, index) => {
        const family = dealTypes.find((type) => String(type.id) === row.deal_type)?.family;
        const rental = family === "RENT" || family === "FULL_MORTGAGE";
        return (
          <div key={`needs-${index}`} className="space-y-3 rounded-xl border p-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <Field label="نوع معامله">
                <select value={row.deal_type} onChange={(event) => update(index, { deal_type: event.target.value })} className={inputCls}>
                  <option value="">انتخاب کنید</option>
                  {dealTypes.map((type) => (
                    <option key={type.id} value={type.id}>{type.display_name || type.name}</option>
                  ))}
                </select>
              </Field>
              {rows.length > 1 ? (
                <Btn color="light" onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}>حذف این نیاز</Btn>
              ) : null}
            </div>
            {rental ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="حداکثر ودیعه (تومان)">
                  <input inputMode="numeric" value={row.max_deposit} onChange={(event) => update(index, { max_deposit: event.target.value })} className={inputCls} />
                </Field>
                <Field label="حداکثر اجارهٔ ماهانه (تومان)">
                  <input inputMode="numeric" value={row.max_monthly_rent} onChange={(event) => update(index, { max_monthly_rent: event.target.value })} className={inputCls} />
                </Field>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="حداقل مبلغ (تومان)">
                  <input inputMode="numeric" value={row.min_amount} onChange={(event) => update(index, { min_amount: event.target.value })} className={inputCls} />
                </Field>
                <Field label="حداکثر مبلغ (تومان)">
                  <input inputMode="numeric" value={row.max_amount} onChange={(event) => update(index, { max_amount: event.target.value })} className={inputCls} />
                </Field>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="حداقل متراژ">
                <input inputMode="numeric" value={row.min_area} onChange={(event) => update(index, { min_area: event.target.value })} className={inputCls} />
              </Field>
              <Field label="حداکثر متراژ">
                <input inputMode="numeric" value={row.max_area} onChange={(event) => update(index, { max_area: event.target.value })} className={inputCls} />
              </Field>
              <Field label="حداقل تعداد اتاق">
                <input inputMode="numeric" value={row.min_rooms} onChange={(event) => update(index, { min_rooms: event.target.value })} className={inputCls} />
              </Field>
            </div>
            <fieldset>
              <legend className="mb-1 text-sm text-muted-foreground">مناطق مطلوب</legend>
              <div className="flex flex-wrap gap-2">
                {districts.map((district) => (
                  <label key={`district-${district.id}`} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${row.districts.includes(String(district.id)) ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/12 dark:text-emerald-300" : ""}`}>
                    <input type="checkbox" className="sr-only" checked={row.districts.includes(String(district.id))} onChange={() => toggleList(index, "districts", String(district.id))} />
                    {district.display_name || district.name}
                  </label>
                ))}
                {!districts.length ? <span className="text-xs text-muted-foreground">منطقه‌ای ثبت نشده است.</span> : null}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1 text-sm text-muted-foreground">انواع ملک مطلوب</legend>
              <div className="flex flex-wrap gap-2">
                {propertyTypes.map((type) => (
                  <label key={`type-${type.id}`} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${row.property_types.includes(String(type.id)) ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/12 dark:text-emerald-300" : ""}`}>
                    <input type="checkbox" className="sr-only" checked={row.property_types.includes(String(type.id))} onChange={() => toggleList(index, "property_types", String(type.id))} />
                    {type.display_name || type.name}
                  </label>
                ))}
                {!propertyTypes.length ? <span className="text-xs text-muted-foreground">نوع ملکی ثبت نشده است.</span> : null}
              </div>
            </fieldset>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">شروط ضروری</span>
                <Btn color="light" onClick={() => update(index, { required_conditions: [...row.required_conditions, { label: "", field: "area", operator: "GTE", value: "" }] })}>افزودن شرط</Btn>
              </div>
              {row.required_conditions.map((condition, conditionIndex) => (
                <div key={`condition-${conditionIndex}`} className="grid gap-2 sm:grid-cols-4">
                  <input value={condition.label} placeholder="برچسب شرط" onChange={(event) => updateCondition(index, conditionIndex, { label: event.target.value })} className={inputCls} />
                  <select value={condition.field} onChange={(event) => updateCondition(index, conditionIndex, { field: event.target.value })} className={inputCls}>
                    {CONDITION_FIELDS.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}
                  </select>
                  <select value={condition.operator} onChange={(event) => updateCondition(index, conditionIndex, { operator: event.target.value })} className={inputCls}>
                    {OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <input value={condition.value} placeholder="مقدار" onChange={(event) => updateCondition(index, conditionIndex, { value: event.target.value })} className={inputCls} />
                    <Btn color="light" onClick={() => update(index, { required_conditions: row.required_conditions.filter((_, itemIndex) => itemIndex !== conditionIndex) })}>حذف</Btn>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <Btn color="light" onClick={() => onChange([...rows, emptyNeedsRow(dealTypes[0]?.id)])}>افزودن نوع معامله</Btn>
    </div>
  );
}
