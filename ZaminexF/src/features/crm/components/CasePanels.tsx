import React, { useState } from "react";
import { useLoad } from "../lib/useCrmLoad";
import { post } from "../lib/crmApi";
import { JalaliDateInput } from "../../../shared/components/ui/JalaliDateInput";
import { JalaliDateTimeInput } from "../../../shared/components/ui/JalaliDateTimeInput";
import { Btn, Field, inputCls } from "../components/CrmUIKit";
import { AccessibleModal } from "./AccessibleModal";
import { emitSupplyCountersRefresh, formatFaInt } from "../lib/supplyDomain";
import type { Row } from "../types";

export function CaseActivityPanel({
  csrfToken,
  subject,
  subjectType,
}: {
  csrfToken: string;
  subject: Row;
  subjectType: "property_case" | "inquiry";
}) {
  const resource = subjectType === "property_case" ? "property-cases" : "inquiries";
  const subjectField = subjectType;
  const timelineUrl = `/crm/api/${resource}/${subject.id}/timeline/`;
  const { data, error, loading, reload } = useLoad([timelineUrl], csrfToken);
  const [message, setMessage] = useState("");
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [followupModalOpen, setFollowupModalOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskPriority, setTaskPriority] = useState("MEDIUM");
  const [taskDescription, setTaskDescription] = useState("");
  const [followupTitle, setFollowupTitle] = useState("");
  const [followupDate, setFollowupDate] = useState("");
  const [followupType, setFollowupType] = useState("Call");
  const [followupNotes, setFollowupNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const assignedId = subject.assigned_to ? Number(subject.assigned_to) : null;
  const events: Row[] = Array.isArray(data[timelineUrl]) ? data[timelineUrl] : [];

  async function createTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskTitle.trim() || !taskDue) return;
    setSubmitting(true);
    try {
      await post(csrfToken, "/tasks/api/tasks/", {
        title: taskTitle.trim(),
        description: taskDescription.trim(),
        task_type: "FOLLOW_UP",
        priority: taskPriority,
        assigned_to: assignedId,
        due_date: taskDue,
        [subjectField]: Number(subject.id),
      });
      setTaskTitle("");
      setTaskDue("");
      setTaskDescription("");
      setTaskModalOpen(false);
      setMessage("کار جدید برای پرونده ثبت شد.");
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "ثبت کار ناموفق بود.");
    } finally {
      setSubmitting(false);
    }
  }

  async function createFollowup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignedId) {
      setMessage("برای ثبت پیگیری ابتدا باید مشاور مسئول پرونده مشخص شود.");
      return;
    }
    if (!followupTitle.trim() || !followupDate) return;
    setSubmitting(true);
    try {
      await post(csrfToken, "/followups/api/followups/", {
        title: followupTitle.trim(),
        type: followupType,
        contact: String(subject.contact_name || subject.code || ""),
        date: new Date(followupDate).toISOString(),
        consultantId: assignedId,
        [subjectField === "property_case" ? "propertyCaseId" : "inquiryId"]: Number(subject.id),
        notes: followupNotes.trim(),
      });
      setFollowupTitle("");
      setFollowupDate("");
      setFollowupNotes("");
      setFollowupModalOpen(false);
      setMessage("پیگیری جدید برای پرونده ثبت شد.");
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "ثبت پیگیری ناموفق بود.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-label="کارها و پیگیری‌ها" className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-foreground">کارها و پیگیری‌ها</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            کارهای مرتبط، تماس‌ها و خط زمانی رویدادهای این پرونده
          </p>
        </div>
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-foreground">
          {formatFaInt(events.length, "۰")} رویداد
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Btn type="button" color="primary" onClick={() => setTaskModalOpen(true)}>
          ثبت کار
        </Btn>
        <Btn type="button" color="light" onClick={() => setFollowupModalOpen(true)}>
          ثبت پیگیری
        </Btn>
      </div>

      {message ? (
        <div role="status" className="rounded-xl bg-secondary px-3 py-2 text-xs text-foreground">
          {message}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="py-6 text-center text-xs text-muted-foreground">در حال بارگذاری رویدادها…</div>
      ) : (
        <div className="max-h-96 space-y-2 overflow-y-auto pr-0.5">
          {events.map((item, idx) => (
            <article key={String(item.id || idx)} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <strong className="text-xs font-semibold text-foreground">{String(item.title || "")}</strong>
                <time className="text-xs text-muted-foreground">
                  {item.at ? new Date(String(item.at)).toLocaleString("fa-IR") : "نامشخص"}
                </time>
              </div>
              {item.detail ? (
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                  {String(item.detail)}
                </p>
              ) : null}
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {item.status ? <span>وضعیت: {String(item.status)}</span> : null}
                {item.assigned_to ? <span>مسئول: {String(item.assigned_to)}</span> : null}
                {item.due ? (
                  <span>موعد: {new Date(String(item.due)).toLocaleDateString("fa-IR")}</span>
                ) : null}
                {item.actor ? <span>ثبت‌کننده: {String(item.actor)}</span> : null}
              </div>
            </article>
          ))}
          {!events.length ? (
            <div className="rounded-xl border border-dashed p-5 text-center text-xs text-muted-foreground">
              هنوز کار یا پیگیری ثبت نشده است.
            </div>
          ) : null}
        </div>
      )}

      <AccessibleModal
        open={taskModalOpen}
        title="ثبت کار مرتبط با پرونده"
        subtitle={`پرونده ${String(subject.code || "")}`}
        maxWidthClass="max-w-md"
        onClose={() => setTaskModalOpen(false)}
      >
        <form onSubmit={createTask} className="space-y-3">
          <Field label="عنوان کار">
            <input
              aria-label="عنوان کار"
              value={taskTitle}
              onChange={(event) => setTaskTitle(event.target.value)}
              placeholder="مانند هماهنگی بازدید یا دریافت تصویر سند"
              className={inputCls}
              required
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <JalaliDateInput label="مهلت انجام" value={taskDue} onChange={setTaskDue} required />
            <Field label="اولویت">
              <select
                value={taskPriority}
                onChange={(event) => setTaskPriority(event.target.value)}
                className={inputCls}
              >
                <option value="LOW">کم</option>
                <option value="MEDIUM">عادی</option>
                <option value="HIGH">بالا</option>
                <option value="URGENT">فوری</option>
              </select>
            </Field>
          </div>
          <Field label="توضیحات تکمیلی">
            <textarea
              value={taskDescription}
              onChange={(event) => setTaskDescription(event.target.value)}
              rows={3}
              className={inputCls}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Btn type="button" color="light" onClick={() => setTaskModalOpen(false)}>
              انصراف
            </Btn>
            <Btn type="submit" disabled={submitting || !taskTitle.trim() || !taskDue}>
              ذخیره کار
            </Btn>
          </div>
        </form>
      </AccessibleModal>

      <AccessibleModal
        open={followupModalOpen}
        title="ثبت پیگیری مرتبط با پرونده"
        subtitle={`پرونده ${String(subject.code || "")}`}
        maxWidthClass="max-w-md"
        onClose={() => setFollowupModalOpen(false)}
      >
        <form onSubmit={createFollowup} className="space-y-3">
          {!assignedId ? (
            <div role="alert" className="rounded-xl bg-amber-500/15 px-3 py-2 text-xs text-foreground">
              برای ثبت پیگیری ابتدا باید مشاور مسئول پرونده تعیین شده باشد.
            </div>
          ) : null}
          <Field label="عنوان پیگیری">
            <input
              aria-label="عنوان پیگیری"
              value={followupTitle}
              onChange={(event) => setFollowupTitle(event.target.value)}
              placeholder="مانند تماس تلفنی با مالک درباره شرایط فروش"
              className={inputCls}
              required
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="نوع تماس">
              <select
                value={followupType}
                onChange={(event) => setFollowupType(event.target.value)}
                className={inputCls}
              >
                <option value="Call">تماس تلفنی</option>
                <option value="Site Visit">بازدید میدانی</option>
                <option value="Meeting">جلسه حضوری</option>
                <option value="Email">ارسال پیام</option>
              </select>
            </Field>
            <JalaliDateTimeInput
              name="followup_at"
              label="زمان پیگیری"
              value={followupDate}
              onChange={setFollowupDate}
              required
            />
          </div>
          <Field label="یادداشت نتیجه یا اقدام بعدی">
            <textarea
              value={followupNotes}
              onChange={(event) => setFollowupNotes(event.target.value)}
              rows={3}
              className={inputCls}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Btn type="button" color="light" onClick={() => setFollowupModalOpen(false)}>
              انصراف
            </Btn>
            <Btn type="submit" disabled={submitting || !assignedId || !followupTitle.trim() || !followupDate}>
              ذخیره پیگیری
            </Btn>
          </div>
        </form>
      </AccessibleModal>
    </section>
  );
}

export function CaseHistoryModal({
  open,
  onClose,
  csrfToken,
  caseId,
  caseCode,
}: {
  open: boolean;
  onClose: () => void;
  csrfToken: string;
  caseId: number | string;
  caseCode: string;
}) {
  const historyUrl = open ? `/crm/api/property-cases/${caseId}/history/` : "";
  const { data, loading, error } = useLoad(historyUrl ? [historyUrl] : [], csrfToken, [open]);
  const payload = (data[historyUrl] || {}) as {
    transitions?: Row[];
    assignments?: Row[];
    reschedules?: Row[];
    withdrawals?: Row[];
    transfers?: Row[];
  };

  const transitions = payload.transitions || [];
  const assignments = payload.assignments || [];
  const reschedules = payload.reschedules || [];
  const withdrawals = payload.withdrawals || [];
  const transfers = payload.transfers || [];

  return (
    <AccessibleModal
      open={open}
      onClose={onClose}
      title={`سوابق کامل پرونده ${caseCode}`}
      subtitle="نمایش یکجا و بدون بخش‌بندی جمع‌شونده از تمامی تغییرات وضعیت، ارجاع، تمدید، انصراف و انتقال رنج"
      maxWidthClass="max-w-3xl"
    >
      {loading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">در حال بارگذاری سوابق پرونده…</div>
      ) : error ? (
        <div role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-foreground">تغییرات مرحله و وضعیت</h3>
            {transitions.length ? (
              transitions.map((row) => (
                <div key={String(row.id)} className="rounded-xl border border-border p-3 text-xs">
                  <div className="flex flex-wrap justify-between gap-2 font-semibold text-foreground">
                    <span>
                      {String(row.action || "")} {row.from_status ? `(${String(row.from_status)} ← ${String(row.to_status)})` : ""}
                    </span>
                    <span className="text-muted-foreground">
                      {row.created_at ? new Date(String(row.created_at)).toLocaleString("fa-IR") : "نامشخص"}
                    </span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    توسط: {String(row.actor_name || "سامانه")}
                    {row.reason ? ` · توضیح: ${String(row.reason)}` : ""}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">تغییر وضعیتی ثبت نشده است.</p>
            )}
          </div>

          <div className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-bold text-foreground">سوابق ارجاع و تغییر مسئول</h3>
            {assignments.length ? (
              assignments.map((row) => (
                <div key={String(row.id)} className="rounded-xl border border-border p-3 text-xs">
                  <div className="flex flex-wrap justify-between gap-2 font-semibold text-foreground">
                    <span>{String(row.action_display || row.action || "")}</span>
                    <span className="text-muted-foreground">
                      {row.created_at ? new Date(String(row.created_at)).toLocaleString("fa-IR") : "نامشخص"}
                    </span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {row.from_user_name ? `از ${String(row.from_user_name)} ` : ""}
                    {row.to_user_name ? `به ${String(row.to_user_name)} ` : ""}
                    {row.due_at ? `· مهلت: ${new Date(String(row.due_at)).toLocaleDateString("fa-IR")} ` : ""}
                    {row.reason ? `· دلیل: ${String(row.reason)}` : ""}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">سابقهٔ ارجاعی ثبت نشده است.</p>
            )}
          </div>

          <div className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-bold text-foreground">درخواست‌های تمدید مهلت و انصراف مشاور</h3>
            {reschedules.length || withdrawals.length ? (
              <>
                {reschedules.map((row) => (
                  <div key={`ext-${String(row.id)}`} className="rounded-xl border border-border p-3 text-xs">
                    <div className="flex flex-wrap justify-between gap-2 font-semibold text-foreground">
                      <span>تمدید مهلت · {String(row.status_display || row.status || "")}</span>
                      <span className="text-muted-foreground">
                        {row.created_at ? new Date(String(row.created_at)).toLocaleString("fa-IR") : "نامشخص"}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      درخواست‌کننده: {String(row.requested_by_name || "نامشخص")} · دلیل: {String(row.reason || "—")}
                      {row.decision_reason ? ` · نظر مدیر: ${String(row.decision_reason)}` : ""}
                    </div>
                  </div>
                ))}
                {withdrawals.map((row) => (
                  <div key={`wd-${String(row.id)}`} className="rounded-xl border border-border p-3 text-xs">
                    <div className="flex flex-wrap justify-between gap-2 font-semibold text-foreground">
                      <span>انصراف مشاور · {String(row.status_display || row.status || "")}</span>
                      <span className="text-muted-foreground">
                        {row.created_at ? new Date(String(row.created_at)).toLocaleString("fa-IR") : "نامشخص"}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      درخواست‌کننده: {String(row.requested_by_name || "نامشخص")} · دلیل: {String(row.reason || "—")}
                      {row.decision_reason ? ` · نظر مدیر: ${String(row.decision_reason)}` : ""}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">درخواست تمدید یا انصرافی ثبت نشده است.</p>
            )}
          </div>

          <div className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-bold text-foreground">سوابق انتقال رنج</h3>
            {transfers.length ? (
              transfers.map((row) => (
                <div key={String(row.id)} className="rounded-xl border border-border p-3 text-xs">
                  <div className="flex flex-wrap justify-between gap-2 font-semibold text-foreground">
                    <span>انتقال رنج</span>
                    <span className="text-muted-foreground">
                      {row.created_at ? new Date(String(row.created_at)).toLocaleString("fa-IR") : "نامشخص"}
                    </span>
                  </div>
                  <div className="mt-1 text-muted-foreground">{String(row.reason || "بدون توضیح")}</div>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">انتقال رنجی ثبت نشده است.</p>
            )}
          </div>
        </div>
      )}
    </AccessibleModal>
  );
}

export function CaseManagementActions({
  csrfToken,
  subject,
  subjectType,
  scopes,
  candidates,
  enabled,
  onChanged,
}: {
  csrfToken: string;
  subject: Row;
  subjectType: "property_case" | "inquiry";
  scopes: Row[];
  candidates: Row[];
  enabled: boolean;
  onChanged: () => void;
}) {
  const [message, setMessage] = useState("");
  const [legacyNote, setLegacyNote] = useState("");
  const [statusChoice, setStatusChoice] = useState("CLOSED");
  const [duplicateId, setDuplicateId] = useState(String(subject.duplicate_of || ""));
  const [reason, setReason] = useState(String(subject.closure_reason || ""));

  if (!enabled) return null;

  const resource = subjectType === "property_case" ? "property-cases" : "inquiries";
  const isClosed = ["CLOSED", "CANCELLED", "DUPLICATE"].includes(String(subject.status || ""));
  const availableScopes = scopes.filter(
    (scope) => scope.is_active && String(scope.id) !== String(subject.scope ?? ""),
  );
  const duplicateCandidates = candidates.filter(
    (candidate) =>
      String(candidate.id) !== String(subject.id) &&
      String(candidate.scope ?? "") === String(subject.scope ?? ""),
  );

  async function run(url: string, body: Row, successMessage: string) {
    try {
      await post(csrfToken, url, body);
      setMessage(successMessage);
      emitSupplyCountersRefresh();
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "عملیات پرونده ناموفق بود.");
    }
  }

  return (
    <section className="space-y-3 border-t pt-4">
      <div>
        <h4 className="font-bold text-foreground">مدیریت وضعیت، تکراری بودن و انتقال رنج</h4>
        <p className="text-xs text-muted-foreground">
          بستن، لغو یا ثبت تکراری بودن پرونده نیازمند ذکر دلیل است و آثار وابسته را به صورت اتمی اعمال می‌کند.
        </p>
      </div>
      {message ? (
        <div role="status" className="rounded-xl bg-secondary px-3 py-2 text-xs text-foreground">
          {message}
        </div>
      ) : null}

      {subjectType === "property_case" && subject.is_legacy && subject.legacy_review_status === "NEEDS_REVIEW" ? (
        <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-xs text-foreground">
            این پرونده از دادهٔ قدیمی منتقل شده است. پس از تطبیق مالک، رنج و مسئول، بازبینی را ثبت کنید.
          </p>
          <Field label="یادداشت بازبینی">
            <input
              value={legacyNote}
              onChange={(event) => setLegacyNote(event.target.value)}
              className={inputCls}
            />
          </Field>
          <Btn
            type="button"
            onClick={() =>
              void run(
                `/crm/api/property-cases/${subject.id}/review_legacy/`,
                { legacy_review_status: "REVIEWED", notes: legacyNote },
                "بازبینی پرونده ثبت شد.",
              )
            }
          >
            ثبت بازبینی پرونده
          </Btn>
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const scopeId = Number(form.get("scope"));
          if (!scopeId || !availableScopes.some((scope) => Number(scope.id) === scopeId)) {
            setMessage("رنج مقصد فعال و مجاز را انتخاب کنید.");
            return;
          }
          void run(
            `/crm/api/${resource}/${subject.id}/transfer_scope/`,
            {
              scope: scopeId,
              reason: String(form.get("reason") || "").trim(),
              version: subject.version,
            },
            "پرونده به رنج انتخاب‌شده منتقل شد.",
          );
        }}
        className="grid gap-2 rounded-xl border p-3 md:grid-cols-3"
      >
        <Field label="انتقال به رنج">
          <select name="scope" required className={inputCls}>
            <option value="">انتخاب رنج مقصد</option>
            {availableScopes.map((scope) => (
              <option key={String(scope.id)} value={String(scope.id)}>
                {String(scope.name || "")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="دلیل انتقال">
          <input name="reason" className={inputCls} />
        </Field>
        <div className="flex items-end">
          <Btn type="submit" color="light" disabled={!availableScopes.length}>
            انتقال رنج
          </Btn>
        </div>
        {!availableScopes.length ? (
          <p className="text-xs text-muted-foreground md:col-span-3">
            رنج فعال دیگری برای انتقال در دسترس نیست.
          </p>
        ) : null}
      </form>

      {subjectType === "property_case" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const cleanReason = reason.trim();
            if (!cleanReason) {
              setMessage("ثبت دلیل برای تغییر وضعیت پرونده الزامی است.");
              return;
            }
            if (statusChoice === "DUPLICATE") {
              if (!duplicateId) {
                setMessage("انتخاب پروندهٔ اصلی برای ثبت تکراری بودن الزامی است.");
                return;
              }
              void run(
                `/crm/api/property-cases/${subject.id}/mark_duplicate/`,
                {
                  duplicate_of: Number(duplicateId),
                  reason: cleanReason,
                  version: subject.version,
                },
                "پرونده به عنوان تکراری ثبت شد.",
              );
              return;
            }
            void run(
              `/crm/api/property-cases/${subject.id}/change_case_status/`,
              {
                status: statusChoice,
                reason: cleanReason,
                version: subject.version,
              },
              statusChoice === "REOPEN" ? "پرونده بازگشایی شد." : "وضعیت پرونده به‌روزرسانی شد.",
            );
          }}
          className="grid gap-2 rounded-xl border p-3 md:grid-cols-3"
        >
          <Field label="عملیات وضعیت پرونده">
            <select
              value={statusChoice}
              onChange={(event) => setStatusChoice(event.target.value)}
              className={inputCls}
            >
              {isClosed ? <option value="REOPEN">بازگشایی پرونده</option> : null}
              <option value="CLOSED">بستن پرونده</option>
              <option value="CANCELLED">لغو پرونده</option>
              <option value="DUPLICATE">ثبت به عنوان پروندهٔ تکراری</option>
            </select>
          </Field>
          {statusChoice === "DUPLICATE" ? (
            <Field label="پروندهٔ اصلی مرجع">
              <select
                value={duplicateId}
                onChange={(event) => setDuplicateId(event.target.value)}
                className={inputCls}
              >
                <option value="">انتخاب پروندهٔ اصلی</option>
                {duplicateCandidates.map((candidate) => (
                  <option key={String(candidate.id)} value={String(candidate.id)}>
                    {String(candidate.code || "")} · {String(candidate.contact_name || candidate.property_title || "")}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <div className="hidden md:block" />
          )}
          <Field label="دلیل تغییر وضعیت (الزامی)">
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="علت بستن، لغو، تکراری بودن یا بازگشایی"
              className={inputCls}
              required
            />
          </Field>
          <div className="md:col-span-3">
            <Btn type="submit" color="light">
              اعمال تغییر وضعیت پرونده
            </Btn>
          </div>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const status = String(form.get("status") || "");
            const closureReason = String(form.get("closure_reason") || "").trim();
            const dupTarget = String(form.get("duplicate_of") || "");
            if ((status === "CLOSED" || status === "DUPLICATE") && !closureReason) {
              setMessage("برای بستن پرونده یا ثبت تکراری، دلیل الزامی است.");
              return;
            }
            if (status === "DUPLICATE" && !duplicateCandidates.some((c) => String(c.id) === dupTarget)) {
              setMessage("پروندهٔ اصلی باید از همان نوع و همان رنج انتخاب شود.");
              return;
            }
            void run(
              `/crm/api/inquiries/${subject.id}/change_status/`,
              {
                status,
                closure_reason: closureReason,
                ...(status === "DUPLICATE" ? { duplicate_of: Number(dupTarget) } : {}),
                version: subject.version,
              },
              "وضعیت پرونده تغییر کرد.",
            );
          }}
          className="grid gap-2 rounded-xl border p-3 md:grid-cols-3"
        >
          <Field label="وضعیت پرونده">
            <select name="status" defaultValue={String(subject.status || "ACTIVE")} className={inputCls}>
              <option value="ACTIVE">فعال</option>
              <option value="COMPLETED">تکمیل‌شده</option>
              <option value="CLOSED">بسته</option>
              <option value="DUPLICATE">تکراری</option>
            </select>
          </Field>
          <Field label="پروندهٔ اصلی در صورت تکراری بودن">
            <select name="duplicate_of" defaultValue={String(subject.duplicate_of || "")} className={inputCls}>
              <option value="">انتخاب پروندهٔ اصلی</option>
              {duplicateCandidates.map((candidate) => (
                <option key={String(candidate.id)} value={String(candidate.id)}>
                  {String(candidate.code || "")} · {String(candidate.contact_name || "")}
                </option>
              ))}
            </select>
          </Field>
          <Field label="دلیل بستن/تکراری بودن">
            <input name="closure_reason" defaultValue={String(subject.closure_reason || "")} className={inputCls} />
          </Field>
          <div className="md:col-span-3">
            <Btn type="submit" color="light">
              ثبت تغییر وضعیت
            </Btn>
          </div>
        </form>
      )}
    </section>
  );
}
