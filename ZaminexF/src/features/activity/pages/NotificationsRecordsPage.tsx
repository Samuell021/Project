import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, CheckCheck, Filter, History, Loader2 } from "lucide-react";
import { Badge } from "../../../shared/components/ui/Badge";
import { EmptyState } from "../../../shared/components/ui/EmptyState";
import { PageHeader } from "../../../shared/components/ui/PageHeader";
import { Card } from "../../../shared/components/ui/Card";
import { Btn } from "../../../shared/components/ui/Btn";
import { JalaliDateInput } from "../../../shared/components/ui/JalaliDateInput";
import { SelectField } from "../../../shared/components/ui/SelectField";
import { isISODate, tehranCalendarDate } from "../../../shared/lib/jdate";
import { usePageQuery } from "../../../shared/lib/pageQuery";
import { apiFetch, readJson } from "../../../shared/lib/apiClient";
import { buildAppPath } from "../../../shared/lib/appRouting";
import type { Page } from "../../../shared/lib/types";

type NotificationItem = {
  id: number;
  type: string;
  typeLabel: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  metadata: Record<string, unknown>;
};

type ActivityItem = {
  id: number;
  userName: string;
  action: string;
  actionLabel: string;
  targetTypeLabel: string;
  targetId: number | null;
  description: string;
  createdAt: string;
};

const NOTIFICATION_FILTERS = [
  { value: "", label: "همه انواع" },
  { value: "task_assigned", label: "وظیفه" },
  { value: "followup_created", label: "پیگیری" },
  { value: "property_pending_review", label: "بررسی ملک" },
  { value: "property_approved", label: "تأیید ملک" },
  { value: "property_rejected", label: "برگشت ملک" },
  { value: "property_file_pending_review", label: "بررسی فایل" },
  { value: "ticket_created", label: "تیکت" },
  { value: "ticket_reply", label: "پاسخ تیکت" },
  { value: "commission_pending", label: "مطالبه کمیسیون" },
  { value: "commission_approved", label: "تأیید مطالبه" },
  { value: "payment_recorded", label: "ثبت وجه" },
  { value: "payment_reversed", label: "برگشت وجه" },
];

const ACTIVITY_FILTERS = [
  { value: "", label: "همه فعالیت‌ها" },
  { value: "create", label: "ایجاد" },
  { value: "update", label: "بروزرسانی" },
  { value: "status_change", label: "تغییر وضعیت" },
  { value: "complete", label: "تکمیل" },
  { value: "approve", label: "تأیید" },
  { value: "reject", label: "رد" },
];

const SUBJECT_TARGETS: Record<string, Page> = {
  PROPERTY_CASE: "crm-property-cases",
  PROPERTY_REGISTRATION_REQUEST: "crm-property-cases",
  INQUIRY: "crm-inquiries",
  INTRODUCTION: "crm-introductions",
  VIEWING: "crm-viewings",
  DEAL: "crm-deals",
  CONTRACT: "crm-contracts",
  TICKET: "tickets-received",
  FOLLOWUP: "follow-ups",
  TASK: "my-tasks",
};

function resolveTarget(metadata: Record<string, unknown>): { page: Page; id?: string } | null {
  const subjectType = String(metadata.subject_type || "").toUpperCase();
  const subjectId = metadata.subject_id;
  const page = SUBJECT_TARGETS[subjectType];
  if (page && (typeof subjectId === "number" || typeof subjectId === "string")) {
    return { page, id: String(subjectId) };
  }
  const ticketId = metadata.ticket_id ?? metadata.ticketId;
  if (typeof ticketId === "number" || typeof ticketId === "string") {
    return { page: metadata.ticketFolder === "sent" ? "tickets-sent" : "tickets-received", id: String(ticketId) };
  }
  const fileId = metadata.property_file_id ?? metadata.propertyFileId;
  if (typeof fileId === "number" || typeof fileId === "string") return { page: "property-file-detail", id: String(fileId) };
  const propertyId = metadata.property_id ?? metadata.propertyId;
  if (typeof propertyId === "number" || typeof propertyId === "string") return { page: "property-detail", id: String(propertyId) };
  return null;
}

const EARLIEST_GREGORIAN_YEAR = 1900;
const LATEST_GREGORIAN_YEAR = 2100;

/**
 * A Gregorian `YYYY-MM-DD` a date field can safely show. A Jalali value such as
 * `1405-07-04` also matches the ISO shape, so the year is bounded to reject it and
 * keep a stale or hand-edited address from rendering a nonsense year again.
 */
function isCalendarISODate(value: string | null): value is string {
  if (!isISODate(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= EARLIEST_GREGORIAN_YEAR && year <= LATEST_GREGORIAN_YEAR;
}

function openTarget(target: { page: Page; id?: string }) {
  const path = buildAppPath(target.page, target.id);
  window.history.pushState({ page: target.page }, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function NotificationsRecordsPage({ csrfToken }: { csrfToken: string }) {
  const { query, update } = usePageQuery();
  const [tab, setTab] = useState(query.get("tab") === "activity" ? "activity" : "notifications");
  // The filter dates live in Gregorian ISO form: that is the contract of
  // `JalaliDateInput` (it renders Gregorian ISO as a Jalali calendar) and the form the
  // notifications API expects. Storing Jalali here used to render a nonsense year and
  // send a far-future range once a date was picked.
  const defaultRange = useMemo(
    () => ({
      from: tehranCalendarDate(new Date(Date.now() - 30 * 86400000).toISOString()),
      to: tehranCalendarDate(new Date().toISOString()),
    }),
    [],
  );
  const [fromDate, setFromDate] = useState(() => {
    const fromQuery = query.get("from");
    return isCalendarISODate(fromQuery) ? fromQuery : defaultRange.from;
  });
  const [toDate, setToDate] = useState(() => {
    const toQuery = query.get("to");
    return isCalendarISODate(toQuery) ? toQuery : defaultRange.to;
  });
  const rangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);
  const [typeFilter, setTypeFilter] = useState(query.get("type") || "");
  const [activityFilter, setActivityFilter] = useState(query.get("action") || "");
  const [unreadOnly, setUnreadOnly] = useState(query.get("unread") === "1");
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (rangeInvalid) {
      // An inverted range would only ever return an empty page; keep the last list
      // and let the inline message explain what to fix.
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page_size: "100" });
      if (typeFilter) params.set("type", typeFilter);
      if (unreadOnly) params.set("unread", "1");
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const notificationsResponse = await apiFetch(`/common/api/notifications/?${params.toString()}`, { method: "GET" }, csrfToken);
      const notificationsData = await readJson(notificationsResponse);
      if (!notificationsResponse.ok) throw new Error("دریافت اعلان‌ها ناموفق بود.");
      setNotifications((notificationsData.notifications || []) as NotificationItem[]);
      setUnreadCount(Number(notificationsData.unreadCount || 0));

      const activityParams = new URLSearchParams({ page_size: "50" });
      if (activityFilter) activityParams.set("action", activityFilter);
      const days = fromDate ? Math.max(1, Math.ceil((Date.now() - new Date(`${fromDate}T00:00:00Z`).getTime()) / 86400000)) : 30;
      activityParams.set("days", String(Math.min(days, 365)));
      const activityResponse = await apiFetch(`/common/api/activity-log/?${activityParams.toString()}`, { method: "GET" }, csrfToken);
      const activityData = await readJson(activityResponse);
      if (!activityResponse.ok) throw new Error("دریافت سوابق فعالیت ناموفق بود.");
      setActivity((activityData.results || []) as ActivityItem[]);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "دریافت اطلاعات ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }, [csrfToken, typeFilter, unreadOnly, fromDate, toDate, activityFilter, rangeInvalid]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyFilters() {
    update({
      tab: tab === "notifications" ? null : tab,
      type: typeFilter || null,
      action: activityFilter || null,
      unread: unreadOnly ? "1" : null,
      from: fromDate || null,
      to: toDate || null,
    });
    void load();
  }

  async function markRead(item: NotificationItem) {
    setMessage("");
    try {
      await apiFetch(`/common/api/notifications/${item.id}/read/`, { method: "POST" }, csrfToken);
      setNotifications((current) => current.map((entry) => (entry.id === item.id ? { ...entry, isRead: true } : entry)));
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "علامت‌گذاری خوانده‌شده ناموفق بود.");
    }
  }

  async function markAllRead() {
    setMessage("");
    try {
      await apiFetch("/common/api/notifications/read-all/", { method: "POST" }, csrfToken);
      setNotifications((current) => current.map((entry) => ({ ...entry, isRead: true })));
      setUnreadCount(0);
      setMessage("همه اعلان‌ها خوانده‌شده شدند.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "عملیات ناموفق بود.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6" dir="rtl">
      <PageHeader
        title="اعلان‌ها و سوابق"
        subtitle="اعلان شخصی با پیوند مقصد و سابقه فعالیت در یک صفحه؛ بازه و نوع در نشانی صفحه باقی می‌مانند."
        actions={<Btn variant="secondary" size="sm" onClick={load} disabled={loading}>{loading ? <Loader2 size={13} className="animate-spin" /> : <History size={13} />} تازه‌سازی</Btn>}
      />
      <div role="status" aria-live="polite" className={message ? "rounded-xl bg-surface-muted px-4 py-2 text-sm" : "sr-only"}>{message}</div>
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Filter size={15} className="text-primary" aria-hidden />
          فیلترها
        </div>
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <JalaliDateInput label="از تاریخ" value={fromDate} onChange={setFromDate} />
          <JalaliDateInput label="تا تاریخ" value={toDate} onChange={setToDate} />
          {tab === "notifications" ? (
            <SelectField label="نوع اعلان" value={typeFilter} onChange={setTypeFilter} options={NOTIFICATION_FILTERS} />
          ) : (
            <SelectField label="نوع فعالیت" value={activityFilter} onChange={setActivityFilter} options={ACTIVITY_FILTERS} />
          )}
          {tab === "notifications" ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">وضعیت خواندن</span>
              <label className="flex min-h-[2.625rem] w-full cursor-pointer items-center gap-2 rounded-xl border border-border bg-input-background px-3.5 py-2.5 text-sm text-foreground transition-colors focus-within:ring-2 focus-within:ring-ring">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-[var(--primary)]"
                  checked={unreadOnly}
                  onChange={(event) => setUnreadOnly(event.target.checked)}
                />
                <span className="min-w-0 truncate">فقط خوانده‌نشده</span>
              </label>
            </div>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Btn variant="primary" size="sm" onClick={applyFilters} disabled={rangeInvalid}>اعمال فیلتر</Btn>
          {tab === "notifications" && unreadCount > 0 ? (
            <Btn variant="secondary" size="sm" onClick={markAllRead}><CheckCheck size={13} /> خوانده‌شدن همه ({unreadCount.toLocaleString("fa-IR")})</Btn>
          ) : null}
          {rangeInvalid ? (
            <p role="alert" className="text-xs text-destructive">تاریخ شروع نمی‌تواند پس از تاریخ پایان باشد.</p>
          ) : null}
        </div>
      </Card>

      <div role="tablist" aria-label="اعلان‌ها و سوابق" className="flex flex-wrap gap-2">
        {[
          { key: "notifications", label: `اعلان‌ها${unreadCount ? ` (${unreadCount.toLocaleString("fa-IR")})` : ""}` },
          { key: "activity", label: "سوابق فعالیت" },
        ].map((item) => (
          <button
            key={item.key}
            role="tab"
            type="button"
            aria-selected={tab === item.key}
            onClick={() => { setTab(item.key); update({ tab: item.key === "notifications" ? null : "activity" }); }}
            className={`rounded-xl px-3 py-1.5 text-sm ${tab === item.key ? "bg-emerald-700 text-white" : "border bg-card hover:bg-secondary"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <Card className="p-4 text-sm">
          <div className="mb-2 text-red-700 dark:text-red-300">{error}</div>
          <Btn variant="secondary" size="sm" onClick={load}>تلاش دوباره</Btn>
        </Card>
      ) : null}

      {tab === "notifications" ? (
        <Card className="divide-y p-0">
          {loaded && notifications.length === 0 ? (
            <EmptyState icon={<BellRing size={22} />} title="اعلانی در این بازه نیست" description="با تغییر بازه یا نوع اعلان دوباره بررسی کنید." />
          ) : (
            <ul>
              {notifications.map((item) => {
                const target = resolveTarget(item.metadata || {});
                return (
                  <li key={item.id} className={`flex flex-wrap items-start justify-between gap-3 p-4 ${item.isRead ? "" : "bg-secondary/40"}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{item.title}</span>
                        <Badge variant={item.isRead ? "muted" : "info"} label={item.isRead ? "خوانده‌شده" : "جدید"} />
                        <span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString("fa-IR")}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {target ? (
                        <Btn variant="ghost" size="sm" onClick={() => { if (!item.isRead) void markRead(item); openTarget(target); }}>
                          مشاهده مقصد
                        </Btn>
                      ) : null}
                      {!item.isRead ? <Btn variant="secondary" size="sm" onClick={() => markRead(item)}>خوانده شد</Btn> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : (
        <Card className="p-0">
          {loaded && activity.length === 0 ? (
            <EmptyState icon={<History size={22} />} title="سابقه‌ای در این بازه نیست" description="بازه را گسترده‌تر کنید یا نوع فعالیت را تغییر دهید." />
          ) : (
            <ul className="divide-y">
              {activity.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.actionLabel}</span>
                      <span className="text-xs text-muted-foreground">{item.userName} · {item.targetTypeLabel}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{item.description}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString("fa-IR")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
