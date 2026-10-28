import { useState } from "react";
import { AccessibleModal } from "./AccessibleModal";
import { Badge } from "../../../shared/components/ui/Badge";
import { Btn, Field, inputCls } from "./CrmUIKit";
import { formatFaMoney, formatFaNumber, type MatchResult } from "../lib/commercialDomain";

export function IntroductionModal({
  open,
  match,
  onClose,
  onConfirm,
  busy,
}: {
  open: boolean;
  match: MatchResult | null;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const snapshot = (match?.snapshot || {}) as Record<string, unknown>;
  const rows: Array<{ label: string; value: string }> = [
    { label: "فایل", value: match?.title || "" },
    { label: "منطقه", value: String(snapshot.district || match?.district || "نامشخص") },
    { label: "متراژ", value: `${formatFaNumber((snapshot.area as string | number) || match?.area)} متر` },
    { label: "تعداد اتاق", value: formatFaNumber(snapshot.rooms as string | number) },
    { label: "نوع معامله", value: match?.deal_type_name || "" },
    { label: "مبلغ فروش", value: formatFaMoney((snapshot.sale_price as string | number) ?? match?.sale_price) },
    { label: "ودیعه", value: formatFaMoney((snapshot.deposit as string | number) ?? match?.deposit) },
    { label: "اجارهٔ ماهانه", value: formatFaMoney((snapshot.monthly_rent as string | number) ?? match?.monthly_rent) },
  ];
  return (
    <AccessibleModal open={open} title="معرفی صریح فایل به متقاضی" subtitle="با ثبت معرفی، تصویر شرایط فعلی فایل در پرونده نگه داشته می‌شود و بعداً قابل تغییر نیست." onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge label={`${formatFaNumber(match?.match_percent ?? 0)}٪ تطبیق`} variant={match?.matched ? "success" : "warning"} />
          {match?.already_introduced ? <Badge label="قبلاً معرفی شده" variant="info" /> : null}
        </div>
        <dl className="grid gap-2 rounded-xl border p-3 text-sm sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="مشاور متقاضی">
            <input readOnly value={match?.buyer_consultant_name || "تعیین نشده"} className={inputCls} />
          </Field>
          <Field label="مشاور ملک">
            <input readOnly value={match?.seller_consultant_name || "تعیین نشده"} className={inputCls} />
          </Field>
        </div>
        <label className="flex items-start gap-2 rounded-xl bg-secondary px-3 py-2 text-sm">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
          <span>شرایط فایل را با متقاضی مرور کردم و معرفی این فایل را تأیید می‌کنم.</span>
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <Btn color="light" onClick={onClose}>انصراف</Btn>
          <Btn onClick={onConfirm} disabled={!confirmed || busy}>{busy ? "در حال ثبت…" : "ثبت معرفی"}</Btn>
        </div>
      </div>
    </AccessibleModal>
  );
}
