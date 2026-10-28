import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSearch, ShieldAlert } from "lucide-react";
import { Badge } from "../../../shared/components/ui/Badge";
import { EmptyState } from "../../../shared/components/ui/EmptyState";
import { post } from "../lib/crmApi";
import { useLoad } from "../lib/useCrmLoad";
import { Btn, Card, Field, SearchBar, Shell, inputCls } from "../components/CrmUIKit";
import {
  emitSupplyCountersRefresh,
  formatFaInt,
  normalizePersianSearch,
  supplyStatusBadgeMeta,
  type PropertyReviewQueueItem,
} from "../lib/supplyDomain";
import type { CrmPageProps } from "../types";

export function ReviewsQueuePage({ csrfToken, role, navigate, embedded }: CrmPageProps) {
  const isManager = role === "admin" || role === "range_manager";
  const [decisionFilter, setDecisionFilter] = useState<"PENDING" | "CHANGES_REQUIRED" | "APPROVED" | "ALL">("PENDING");
  const [search, setSearch] = useState("");
  const [titles, setTitles] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [feedback, setFeedback] = useState("");
  const [fieldErrorByReview, setFieldErrorByReview] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const listUrl = isManager ? `/crm/api/reviews/?decision=${decisionFilter}` : "";
  const { data, error, loading, reload } = useLoad(listUrl ? [listUrl] : [], csrfToken, [decisionFilter, isManager]);

  const rawItems = (data[listUrl] || []) as PropertyReviewQueueItem[];
  const filteredItems = useMemo(() => {
    const q = normalizePersianSearch(search);
    if (!q) return rawItems;
    return rawItems.filter((item) =>
      normalizePersianSearch(
        `${item.case_code} ${item.property_code} ${item.property_title} ${item.assignee_name || ""} ${item.property_district || ""}`,
      ).includes(q),
    );
  }, [rawItems, search]);

  if (!isManager) {
    return (
      <Shell title="تأیید ملک" subtitle="صف بررسی و تأیید گزارش‌های کارشناسی ملک" embedded={embedded}>
        <Card className="py-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <ShieldAlert size={22} />
          </div>
          <h2 className="text-base font-bold text-foreground">عدم دسترسی به صف تأیید ملک</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            بررسی گزارش کارشناسی و تأیید نهایی ملک فقط در اختیار مدیر رنج و مدیر ارشد است.
          </p>
        </Card>
      </Shell>
    );
  }

  async function decideReview(item: PropertyReviewQueueItem, decision: "APPROVED" | "CHANGES_REQUIRED") {
    const chosenTitle = (titles[item.id] ?? item.property_title ?? "").trim();
    const chosenReason = (reasons[item.id] ?? "").trim();
    if (decision === "APPROVED" && !chosenTitle) {
      setFieldErrorByReview((prev) => ({
        ...prev,
        [item.id]: "پیش از تأیید نهایی ملک، تعیین عنوان مدیریتی ملک الزامی است.",
      }));
      return;
    }
    if (decision === "CHANGES_REQUIRED" && !chosenReason) {
      setFieldErrorByReview((prev) => ({
        ...prev,
        [item.id]: "برای بازگرداندن پرونده به مرحلهٔ کارشناسی، ثبت دلیل اصلاح الزامی است.",
      }));
      return;
    }
    setFieldErrorByReview((prev) => ({ ...prev, [item.id]: "" }));
    setBusyId(item.id);
    try {
      await post(csrfToken, `/crm/api/reviews/${item.id}/decide/`, {
        decision,
        property_title: chosenTitle,
        reason: chosenReason,
        version: item.version,
        ...(typeof item.case_version === "number" ? { case_version: item.case_version } : {}),
      });
      setFeedback(
        decision === "APPROVED"
          ? `ملک «${chosenTitle}» تأیید شد و امکان تعریف فایل عرضه فعال گردید.`
          : `پرونده ${item.case_code} با ذکر علت برای اصلاح کارشناسی بازگردانده شد.`,
      );
      emitSupplyCountersRefresh();
      reload();
    } catch (err) {
      setFieldErrorByReview((prev) => ({
        ...prev,
        [item.id]: err instanceof Error ? err.message : "ثبت تصمیم بررسی ناموفق بود.",
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Shell
      title="تأیید ملک"
      subtitle="بررسی گزارش کارشناسی، تعیین عنوان مدیریتی و تأیید نهایی املاک پیش از تعریف فایل عرضه"
      error={error}
      loading={loading}
      onReload={reload}
      embedded={embedded}
    >
      {feedback ? (
        <div role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm text-foreground">
          <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
          <span>{feedback}</span>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="فیلتر وضعیت بررسی">
          {([
            ["PENDING", "در انتظار بررسی"],
            ["CHANGES_REQUIRED", "نیازمند اصلاح"],
            ["APPROVED", "تأییدشده"],
            ["ALL", "همه"],
          ] as const).map(([code, label]) => (
            <button
              key={code}
              type="button"
              role="tab"
              aria-selected={decisionFilter === code}
              onClick={() => setDecisionFilter(code)}
              className={`rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors ${
                decisionFilter === code
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card text-foreground hover:bg-secondary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {formatFaInt(filteredItems.length, "۰")} مورد در این نما
        </span>
      </div>

      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="جست‌وجو بر اساس کد پرونده، کد ملک، عنوان، محله یا نام مشاور…"
      />

      {!filteredItems.length ? (
        <Card>
          <EmptyState
            icon={<FileSearch size={28} />}
            title="موردی در این صف وجود ندارد"
            description="هنگامی که مشاور گزارش کارشناسی کامل را برای تأیید ارسال کند، در این صف نمایش داده می‌شود."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredItems.map((item) => {
            const titleVal = titles[item.id] ?? item.property_title ?? "";
            const reasonVal = reasons[item.id] ?? item.reason ?? "";
            const badgeMeta = supplyStatusBadgeMeta("property_review", item.decision);
            const rowErr = fieldErrorByReview[item.id];
            const isPending = item.decision === "PENDING";
            const snapshot = item.snapshot || {};
            const snapshotAttributes = snapshot.attributes || [];
            const snapshotImages = snapshot.images || [];

            return (
              <Card key={item.id} className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-muted-foreground">
                        {item.case_code || item.property_code}
                      </span>
                      <Badge label={badgeMeta.label} variant={badgeMeta.variant} dot />
                      <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground">
                        نسخهٔ ارسالی: {formatFaInt(item.version)}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-foreground">
                      {snapshot.property_title || snapshot.title || item.property_title || "بدون عنوان مدیریتی"}
                    </h3>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>رنج: {item.scope_name || "نامشخص"}</span>
                      <span>مشاور مسئول: {item.assignee_name || item.submitted_by_name || "نامشخص"}</span>
                      <span>منطقه: {snapshot.location_path || item.property_district || "نامشخص"}</span>
                      <span>متراژ: {formatFaInt(snapshot.area ?? item.property_area)} متر مربع</span>
                      <span>نوع ملک: {snapshot.property_type_display || item.property_type_display || "نامشخص"}</span>
                      {snapshot.property_usage_name ? <span>کاربری: {snapshot.property_usage_name}</span> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.registration_request ? (
                      <Btn
                        type="button"
                        color="light"
                        onClick={() => navigate("crm-property-cases", item.registration_request ?? undefined)}
                      >
                        مشاهده پرونده
                      </Btn>
                    ) : null}
                    <Btn type="button" color="light" onClick={() => navigate("property-detail", item.property)}>
                      جزئیات ملک
                    </Btn>
                  </div>
                </div>

                <div className="grid gap-3 rounded-xl border border-border p-3.5 text-xs md:grid-cols-2">
                  <div className="space-y-1.5">
                    <strong className="text-foreground">موقعیت ثبت‌شده در نسخهٔ ارسالی</strong>
                    <div className="text-muted-foreground">
                      {snapshot.location_path || [snapshot.province_name, snapshot.city_name, item.property_district].filter(Boolean).join(" / ") || "موقعیت ثبت نشده"}
                    </div>
                    {snapshot.latitude != null && snapshot.longitude != null ? (
                      <div className="font-mono text-muted-foreground" dir="ltr">{snapshot.latitude}, {snapshot.longitude}</div>
                    ) : <div className="text-muted-foreground">مختصات نقشه ثبت نشده است.</div>}
                  </div>
                  <div>
                    <strong className="text-foreground">ویژگی‌های ثبت‌شده در نسخهٔ ارسالی</strong>
                    {snapshotAttributes.length ? (
                      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                        {snapshotAttributes.map((attribute) => (
                          <React.Fragment key={`${attribute.id}:${attribute.name}`}>
                            <dt className="text-muted-foreground">{attribute.display_name}</dt>
                            <dd className="break-words text-foreground">{attribute.display_value || "—"}</dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    ) : <p className="mt-1 text-muted-foreground">ویژگی پویایی ثبت نشده است.</p>}
                  </div>
                  <div className="md:col-span-2">
                    <strong className="text-foreground">تصاویر همراه درخواست ({snapshotImages.length})</strong>
                    {snapshotImages.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {snapshotImages.map((image) => image.url ? (
                          <a key={image.id} href={image.url} target="_blank" rel="noreferrer" className="block h-20 w-20 overflow-hidden rounded-lg border border-border">
                            <img src={image.url} alt={`تصویر ملک ${image.id}`} className="h-full w-full object-cover" />
                          </a>
                        ) : null)}
                      </div>
                    ) : <p className="mt-1 text-muted-foreground">تصویری در نسخهٔ ارسالی نبوده است.</p>}
                  </div>
                </div>

                {item.version_drift ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-amber-500/45 bg-amber-500/12 px-3.5 py-2.5 text-xs text-foreground"
                  >
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div>
                      <strong className="font-bold">هشدار تغییر نسخه پس از ارسال:</strong> اطلاعات کارشناسی پس از ثبت این درخواست تغییر کرده است (نسخهٔ فعلی ملک: {formatFaInt(item.current_review_version)}). پیش از تصمیم‌گیری، آخرین وضعیت پرونده را بررسی کنید.
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-3 rounded-xl bg-secondary/60 p-3.5 text-xs md:grid-cols-2">
                  <div>
                    <span className="font-semibold text-foreground">گزارش کارشناسی مشاور:</span>
                    <p className="mt-1 whitespace-pre-wrap leading-relaxed text-muted-foreground">
                      {item.appraisal_summary?.report_text || "گزارش متنی ثبت نشده است."}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <div>
                      <span className="font-semibold text-foreground">نشانی ملک: </span>
                      <span className="text-muted-foreground">{snapshot.address || item.property_address || "نامشخص"}</span>
                    </div>
                    {item.appraisal_summary?.visit_notes ? (
                      <div>
                        <span className="font-semibold text-foreground">یادداشت بازدید: </span>
                        <span className="text-muted-foreground">{item.appraisal_summary.visit_notes}</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                {rowErr ? (
                  <div role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {rowErr}
                  </div>
                ) : null}

                {isPending ? (
                  <div className="grid gap-3 pt-1 md:grid-cols-2">
                    <Field label="عنوان مدیریتی ملک (الزامی برای تأیید نهایی)">
                      <input
                        value={titleVal}
                        onChange={(event) =>
                          setTitles((prev) => ({ ...prev, [item.id]: event.target.value }))
                        }
                        placeholder="مانند آپارتمان ۱۴۵ متری سه‌خوابه در جردن"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="علت نیازمند اصلاح بودن (الزامی در صورت بازگرداندن)">
                      <input
                        value={reasonVal}
                        onChange={(event) =>
                          setReasons((prev) => ({ ...prev, [item.id]: event.target.value }))
                        }
                        placeholder="موارد ناقص یا ابهام کارشناسی را بنویسید"
                        className={inputCls}
                      />
                    </Field>
                    <div className="flex flex-wrap items-center gap-2 md:col-span-2">
                      <Btn
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void decideReview(item, "APPROVED")}
                      >
                        تأیید نهایی ملک
                      </Btn>
                      <Btn
                        type="button"
                        color="danger"
                        disabled={busyId === item.id}
                        onClick={() => void decideReview(item, "CHANGES_REQUIRED")}
                      >
                        نیازمند اصلاح (بازگشت به کارشناسی)
                      </Btn>
                    </div>
                  </div>
                ) : item.reason ? (
                  <p className="text-xs text-muted-foreground">
                    توضیح ثبت‌شده در بررسی: <span className="text-foreground">{item.reason}</span>
                  </p>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
