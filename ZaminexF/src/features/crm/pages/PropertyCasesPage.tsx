import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  FolderOpen,
  History,
  LayoutGrid,
  List,
  Plus,
} from "lucide-react";
import { Badge } from "../../../shared/components/ui/Badge";
import { ConsultantCombobox } from "../../../shared/components/ui/ConsultantCombobox";
import { JalaliDateTimeInput } from "../../../shared/components/ui/JalaliDateTimeInput";
import { EmptyState } from "../../../shared/components/ui/EmptyState";
import { usePermissions, type Role } from "../../../shared/lib/permissions";
import { CaseActivityPanel, CaseHistoryModal, CaseManagementActions } from "../components/CasePanels";
import { Btn, Card, Field, SearchBar, Shell, inputCls } from "../components/CrmUIKit";
import { post } from "../lib/crmApi";
import { buildAssignableStaffOptions, type AssignableStaffRow } from "../lib/staffDomain";
import { useLoad } from "../lib/useCrmLoad";
import {
  STAGE_LABELS_FA,
  clearLastVisitedCase,
  computeStallInfo,
  emitSupplyCountersRefresh,
  formatFaInt,
  normalizePersianSearch,
  readLastVisitedCase,
  saveLastVisitedCase,
  stageGuidanceForRole,
  supplyStatusBadgeMeta,
  type PropertyCaseRecord,
  type SupplyStage,
} from "../lib/supplyDomain";
import type { CrmPageProps, Row } from "../types";

const STAGE_ORDER: readonly SupplyStage[] = [
  "reception",
  "assignment",
  "acceptance",
  "appraisal",
  "review",
  "listing",
  "closed",
];

function readQueryState() {
  if (typeof window === "undefined") {
    return { stage: "", search: "", view: "cards" as "cards" | "table" };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    stage: params.get("stage") || "",
    search: params.get("search") || "",
    view: params.get("view") === "table" ? ("table" as const) : ("cards" as const),
  };
}

function writeQueryState(next: { stage: string; search: string; view: "cards" | "table" }) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (next.stage) params.set("stage", next.stage);
  else params.delete("stage");
  if (next.search.trim()) params.set("search", next.search.trim());
  else params.delete("search");
  if (next.view === "table") params.set("view", "table");
  else params.delete("view");
  const suffix = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${suffix ? `?${suffix}` : ""}`);
}

export function PropertyCasesPage({ csrfToken, role, currentUserId, recordId, navigate, embedded }: CrmPageProps) {
  const { can } = usePermissions();
  const typedRole = (role || "consultant") as Role;
  const isManager = typedRole === "admin" || typedRole === "range_manager";
  const userKey = `${typedRole}:${currentUserId || "self"}`;

  const initialQuery = useMemo(() => readQueryState(), []);
  const [stageFilter, setStageFilter] = useState<string>(initialQuery.stage);
  const [search, setSearch] = useState<string>(initialQuery.search);
  const [viewMode, setViewMode] = useState<"cards" | "table">(initialQuery.view);
  const [lastVisited, setLastVisited] = useState(() => readLastVisitedCase(userKey));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");

  const [assigneeId, setAssigneeId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [extDueAt, setExtDueAt] = useState("");
  const [extReason, setExtReason] = useState("");
  const [withdrawReason, setWithdrawReason] = useState("");
  const [managerTitle, setManagerTitle] = useState("");
  const [reviewDecision, setReviewDecision] = useState<"APPROVED" | "CHANGES_REQUIRED">("APPROVED");
  const [reviewReason, setReviewReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");

  const detailUrl = recordId ? `/crm/api/property-cases/${recordId}/` : "";
  const listUrl = `/crm/api/property-cases/${stageFilter ? `?stage=${encodeURIComponent(stageFilter)}` : ""}`;
  const urls = recordId
    ? [
        detailUrl,
        "/crm/api/property-cases/",
        "/crm/api/scopes/",
        ...(isManager ? [`/crm/api/property-cases/${recordId}/assignable-staff/`] : []),
        `/crm/api/reschedules/?subject_type=PROPERTY_CASE&subject_id=${recordId}`,
        `/crm/api/withdrawals/?subject_type=PROPERTY_CASE&subject_id=${recordId}`,
      ]
    : [listUrl];

  const { data, error, loading, reload } = useLoad(urls, csrfToken, [recordId, stageFilter, isManager]);

  const activeCase = recordId ? ((data[detailUrl] || null) as PropertyCaseRecord | null) : null;
  const listItems = ((recordId ? data["/crm/api/property-cases/"] : data[listUrl]) || []) as PropertyCaseRecord[];
  const scopes = (data["/crm/api/scopes/"] || []) as Row[];
  const assignableStaff = buildAssignableStaffOptions(
    data[`/crm/api/property-cases/${recordId}/assignable-staff/`] as AssignableStaffRow[] | undefined,
  );
  const reschedules = (data[`/crm/api/reschedules/?subject_type=PROPERTY_CASE&subject_id=${recordId}`] || []) as Row[];
  const withdrawals = (data[`/crm/api/withdrawals/?subject_type=PROPERTY_CASE&subject_id=${recordId}`] || []) as Row[];

  useEffect(() => {
    if (!recordId) {
      setLastVisited(readLastVisitedCase(userKey));
      writeQueryState({ stage: stageFilter, search, view: viewMode });
    }
  }, [recordId, stageFilter, search, viewMode, userKey]);

  useEffect(() => {
    if (!activeCase) return;
    setManagerTitle(activeCase.property_title || "");
    saveLastVisitedCase(userKey, {
      id: activeCase.id,
      code: activeCase.code,
      title: activeCase.property_title || activeCase.contact_name || activeCase.code,
      stageLabel: STAGE_LABELS_FA[activeCase.stage] || activeCase.stage,
    });
  }, [activeCase, userKey]);

  const filteredItems = useMemo(() => {
    const q = normalizePersianSearch(search);
    if (!q) return listItems;
    return listItems.filter((item) =>
      normalizePersianSearch(
        `${item.code} ${item.property_title || ""} ${item.description || ""} ${item.contact_name || ""} ${item.assigned_to_name || ""} ${item.scope_name || ""}`,
      ).includes(q),
    );
  }, [listItems, search]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const st of STAGE_ORDER) counts[st] = 0;
    for (const item of listItems) {
      counts[item.stage] = (counts[item.stage] || 0) + 1;
    }
    return counts;
  }, [listItems]);

  async function runAction(url: string, body: Row, okText: string) {
    setActionError("");
    setActionMessage("");
    try {
      await post(csrfToken, url, body);
      setActionMessage(okText);
      emitSupplyCountersRefresh();
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "اجرای عملیات ناموفق بود.");
    }
  }

  if (typedRole === "finance") {
    return (
      <Shell title="پرونده‌های ثبت ملک" subtitle="مدیریت جریان تأمین ملک" embedded={embedded}>
        <Card className="py-10 text-center">
          <p className="text-sm font-semibold text-foreground">عدم دسترسی به پرونده‌های عملیاتی تأمین ملک</p>
          <p className="mt-1 text-xs text-muted-foreground">نقش مالی فقط به بخش کمیسیون، وجوه و گزارش‌های مالی دسترسی دارد.</p>
        </Card>
      </Shell>
    );
  }

  if (recordId) {
    if (loading) {
      return (
        <Shell title="جزئیات پروندهٔ تأمین ملک" loading embedded={embedded}>
          <div />
        </Shell>
      );
    }
    if (error || !activeCase) {
      return (
        <Shell title="جزئیات پروندهٔ تأمین ملک" error={error || "پروندهٔ مورد نظر یافت نشد یا در محدودهٔ دسترسی شما نیست."} onReload={reload} embedded={embedded}>
          <Btn type="button" color="light" onClick={() => navigate("crm-property-cases")}>
            بازگشت به فهرست پرونده‌ها
          </Btn>
        </Shell>
      );
    }

    const stall = computeStallInfo(activeCase);
    const guidance = stageGuidanceForRole(activeCase, typedRole, currentUserId);
    const caseBadge = supplyStatusBadgeMeta("case", activeCase.status);
    const propReviewBadge = supplyStatusBadgeMeta("property_review", activeCase.property_review_status);
    const pendingExt = reschedules.find((r) => r.status === "PENDING");
    const pendingWd = withdrawals.find((w) => w.status === "PENDING");
    return (
      <Shell
        title={`پرونده ${activeCase.code}`}
        subtitle={activeCase.property_title || activeCase.description || activeCase.contact_name}
        onReload={reload}
        embedded={embedded}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Btn type="button" onClick={() => navigate("crm-property-register")}>
              <span className="inline-flex items-center gap-1.5">
                <Plus size={14} />
                ثبت جدید
              </span>
            </Btn>
            <Btn type="button" color="light" onClick={() => navigate("crm-property-cases")}>
              <span className="inline-flex items-center gap-1.5">
                <FolderOpen size={14} />
                پرونده‌ها
              </span>
            </Btn>
            <Btn type="button" color="light" onClick={() => setHistoryOpen(true)}>
              <span className="inline-flex items-center gap-1.5">
                <History size={14} />
                سوابق
              </span>
            </Btn>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn type="button" color="light" onClick={() => navigate("crm-property-register", activeCase.id)}>
              ادامه در ویزارد هفت‌مرحله‌ای
            </Btn>
            {activeCase.resulting_property ? (
              <Btn type="button" color="light" onClick={() => navigate("property-detail", activeCase.resulting_property ?? undefined)}>
                جزئیات ملک ({activeCase.resulting_property_code || formatFaInt(activeCase.resulting_property)})
              </Btn>
            ) : null}
          </div>
        </div>

        {actionMessage ? (
          <div role="status" className="mb-4 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm text-foreground">
            {actionMessage}
          </div>
        ) : null}
        {actionError ? (
          <div role="alert" className="mb-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {actionError}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-8">
            <Card className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge label={`مرحله: ${STAGE_LABELS_FA[activeCase.stage]}`} variant="teal" dot />
                  <Badge label={caseBadge.label} variant={caseBadge.variant} dot />
                  {activeCase.resulting_property ? (
                    <Badge label={`وضعیت ملک: ${propReviewBadge.label}`} variant={propReviewBadge.variant} dot />
                  ) : null}
                  {stall.isStalled ? <Badge label="راکد" variant="danger" /> : null}
                </div>
                <span className="text-xs text-muted-foreground">نسخه: {formatFaInt(activeCase.version)}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                <div className="rounded-xl bg-secondary p-3">
                  <span className="block text-muted-foreground">شخص مرتبط</span>
                  <strong className="mt-1 block text-sm text-foreground">{activeCase.contact_name || "نامشخص"}</strong>
                  {activeCase.contact_phones?.length ? (
                    <span className="mt-0.5 block font-mono text-muted-foreground">
                      {activeCase.contact_phones.join(" · ")}
                    </span>
                  ) : null}
                </div>
                <div className="rounded-xl bg-secondary p-3">
                  <span className="block text-muted-foreground">رنج فروش</span>
                  <strong className="mt-1 block text-sm text-foreground">
                    {activeCase.scope_name || activeCase.sales_range_name || "نامشخص"}
                  </strong>
                  <span className="mt-0.5 block text-muted-foreground">
                    منبع: {activeCase.lead_source_display || "نامشخص"}
                  </span>
                </div>
                <div className="rounded-xl bg-secondary p-3">
                  <span className="block text-muted-foreground">مشاور مسئول و مهلت</span>
                  <strong className="mt-1 block text-sm text-foreground">
                    {activeCase.assigned_to_name || "تعیین‌نشده"}
                  </strong>
                  <span className="mt-0.5 block text-muted-foreground">
                    مهلت: {activeCase.due_at ? new Date(activeCase.due_at).toLocaleDateString("fa-IR") : "نامشخص"}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5 text-xs">
                <span className="font-bold text-foreground">الان چه کاری انجام بدهم؟ — {guidance.headline}</span>
                <p className="mt-1 leading-relaxed text-muted-foreground">{guidance.body}</p>
              </div>
            </Card>

            <Card className="space-y-4">
              <h3 className="text-sm font-bold text-foreground">اقدام‌های مرحله‌ای پرونده</h3>

              {activeCase.stage === "reception" && (isManager || can("case.accept_lead")) ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
                  <span className="text-xs text-muted-foreground">بررسی اولیه انجام شد؟ سرنخ را بپذیرید تا وارد مرحلهٔ ارجاع شود.</span>
                  <Btn
                    type="button"
                    onClick={() =>
                      void runAction(
                        `/crm/api/property-cases/${activeCase.id}/accept_lead/`,
                        { version: activeCase.version },
                        "سرنخ پذیرفته شد.",
                      )
                    }
                  >
                    پذیرش سرنخ
                  </Btn>
                </div>
              ) : null}

              {(activeCase.stage === "assignment" || (isManager && activeCase.assigned_to)) && (isManager || can("case.assign")) ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!assigneeId || !dueAt) {
                      setActionError("انتخاب مشاور مسئول و مهلت انجام کارشناسی الزامی است.");
                      return;
                    }
                    const endpoint = activeCase.stage === "assignment" ? "assign" : "change_assignee";
                    void runAction(
                      `/crm/api/property-cases/${activeCase.id}/${endpoint}/`,
                      {
                        assigned_to: Number(assigneeId),
                        due_at: new Date(dueAt).toISOString(),
                        version: activeCase.version,
                      },
                      activeCase.stage === "assignment" ? "پرونده به مشاور ارجاع شد." : "مشاور مسئول پرونده تغییر کرد.",
                    );
                  }}
                  className="grid gap-3 rounded-xl border p-3 sm:grid-cols-3"
                >
                  <ConsultantCombobox
                    label={activeCase.stage === "assignment" ? "ارجاع به مشاور" : "تغییر مشاور مسئول"}
                    required
                    consultants={assignableStaff}
                    allowedRoles={["AGENT", "RANGE_MANAGER", "ADMIN"]}
                    loading={loading && !assignableStaff.length}
                    value={assigneeId}
                    onChange={setAssigneeId}
                  />
                  <JalaliDateTimeInput name="due_at" label="مهلت کارشناسی (الزامی)" value={dueAt} onChange={setDueAt} required />
                  <div className="flex items-end">
                    <Btn type="submit">{activeCase.stage === "assignment" ? "ثبت ارجاع" : "ثبت تغییر مسئول"}</Btn>
                  </div>
                </form>
              ) : null}

              {activeCase.stage === "acceptance" ? (
                <div className="space-y-3 rounded-xl border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">پاسخ مشاور به ارجاع پرونده</span>
                    <Btn
                      type="button"
                      onClick={() =>
                        void runAction(
                          `/crm/api/property-cases/${activeCase.id}/accept_assignment/`,
                          { version: activeCase.version },
                          "ارجاع پذیرفته شد و مرحلهٔ کارشناسی فعال گردید.",
                        )
                      }
                    >
                      پذیرش ارجاع
                    </Btn>
                  </div>
                  <div className="grid gap-2 border-t pt-3 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <input
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="دلیل رد ارجاع (الزامی برای بازگرداندن به مدیر)"
                        className={inputCls}
                      />
                    </div>
                    <Btn
                      type="button"
                      color="danger"
                      onClick={() => {
                        if (!rejectReason.trim()) {
                          setActionError("برای رد ارجاع ثبت دلیل الزامی است.");
                          return;
                        }
                        void runAction(
                          `/crm/api/property-cases/${activeCase.id}/reject_assignment/`,
                          { reason: rejectReason.trim(), version: activeCase.version },
                          "ارجاع رد شد و پرونده به مرحلهٔ ارجاع مدیر بازگشت.",
                        );
                      }}
                    >
                      رد ارجاع
                    </Btn>
                  </div>
                </div>
              ) : null}

              {isManager ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!managerTitle.trim()) {
                      setActionError("عنوان مدیریتی ملک نمی‌تواند خالی باشد.");
                      return;
                    }
                    void runAction(
                      `/crm/api/property-cases/${activeCase.id}/set_property_title/`,
                      { property_title: managerTitle.trim(), version: activeCase.version },
                      "عنوان مدیریتی ملک ذخیره شد.",
                    );
                  }}
                  className="grid gap-2 rounded-xl border p-3 sm:grid-cols-3"
                >
                  <div className="sm:col-span-2">
                    <Field label="عنوان مدیریتی ملک (اختصاصی مدیر رنج / مدیر ارشد)">
                      <input
                        value={managerTitle}
                        onChange={(e) => setManagerTitle(e.target.value)}
                        placeholder="عنوان رسمی ملک برای نمایش سازمانی و فایل عرضه"
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <div className="flex items-end">
                    <Btn type="submit" color="light">
                      ذخیره عنوان ملک
                    </Btn>
                  </div>
                </form>
              ) : null}

              {activeCase.stage === "review" && isManager ? (
                <div className="space-y-3 rounded-xl border border-amber-500/35 bg-amber-500/5 p-3">
                  <h4 className="text-xs font-bold text-foreground">تصمیم بررسی کارشناسی ملک</h4>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="نتیجه بررسی">
                      <select
                        value={reviewDecision}
                        onChange={(e) => setReviewDecision(e.target.value as "APPROVED" | "CHANGES_REQUIRED")}
                        className={inputCls}
                      >
                        <option value="APPROVED">تأیید نهایی ملک</option>
                        <option value="CHANGES_REQUIRED">نیازمند اصلاح کارشناسی</option>
                      </select>
                    </Field>
                    <Field label="توضیح یا علت اصلاح">
                      <input
                        value={reviewReason}
                        onChange={(e) => setReviewReason(e.target.value)}
                        placeholder={reviewDecision === "CHANGES_REQUIRED" ? "ثبت علت اصلاح الزامی است" : "توضیح اختیاری"}
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <Btn
                    type="button"
                    onClick={() =>
                      void runAction(
                        `/crm/api/property-cases/${activeCase.id}/review_property/`,
                        {
                          decision: reviewDecision,
                          property_title: managerTitle.trim(),
                          reason: reviewReason.trim(),
                          case_version: activeCase.version,
                        },
                        reviewDecision === "APPROVED"
                          ? "ملک تأیید نهایی شد."
                          : "پرونده برای اصلاح کارشناسی بازگردانده شد.",
                      )
                    }
                  >
                    ثبت تصمیم بررسی
                  </Btn>
                </div>
              ) : null}

              {activeCase.stage === "listing" && isManager ? (
                <div className="grid gap-2 rounded-xl border p-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Field label="بازگشایی کارشناسی (فایل‌های عرضهٔ فعال به حالت متوقف می‌روند)">
                      <input
                        value={reopenReason}
                        onChange={(e) => setReopenReason(e.target.value)}
                        placeholder="علت بازبینی مجدد کارشناسی ملک"
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <div className="flex items-end">
                    <Btn
                      type="button"
                      color="light"
                      onClick={() =>
                        void runAction(
                          `/crm/api/property-cases/${activeCase.id}/reopen_appraisal/`,
                          { reason: reopenReason.trim(), version: activeCase.version },
                          "کارشناسی ملک بازگشایی شد و گزارش قبلی بایگانی گردید.",
                        )
                      }
                    >
                      بازگشایی کارشناسی
                    </Btn>
                  </div>
                </div>
              ) : null}

              {activeCase.acceptance_status === "ACCEPTED" && activeCase.stage !== "closed" ? (
                <div className="grid gap-3 border-t pt-3 md:grid-cols-2">
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!extDueAt || !extReason.trim()) return;
                      void runAction(
                        `/crm/api/property-cases/${activeCase.id}/request_extension/`,
                        {
                          requested_due_at: new Date(extDueAt).toISOString(),
                          reason: extReason.trim(),
                        },
                        "درخواست تمدید مهلت ثبت شد.",
                      );
                    }}
                    className="space-y-2 rounded-xl border p-3"
                  >
                    <strong className="text-xs font-semibold text-foreground">درخواست تمدید مهلت</strong>
                    <JalaliDateTimeInput
                      name="requested_due_at"
                      label="مهلت جدید"
                      value={extDueAt}
                      onChange={setExtDueAt}
                      required
                    />
                    <input
                      value={extReason}
                      onChange={(e) => setExtReason(e.target.value)}
                      placeholder="علت نیاز به تمدید مهلت"
                      className={inputCls}
                      required
                    />
                    <Btn type="submit" color="light" disabled={Boolean(pendingExt)}>
                      {pendingExt ? "درخواست تمدید در انتظار بررسی" : "ثبت درخواست تمدید"}
                    </Btn>
                    {pendingExt && isManager ? (
                      <div className="flex gap-2 pt-1">
                        <Btn
                          type="button"
                          onClick={() =>
                            void runAction(
                              `/crm/api/reschedules/${String(pendingExt.id)}/decide/`,
                              { status: "APPROVED" },
                              "تمدید مهلت تأیید شد.",
                            )
                          }
                        >
                          تأیید تمدید
                        </Btn>
                        <Btn
                          type="button"
                          color="danger"
                          onClick={() =>
                            void runAction(
                              `/crm/api/reschedules/${String(pendingExt.id)}/decide/`,
                              { status: "REJECTED", decision_reason: "عدم موافقت مدیر" },
                              "درخواست تمدید رد شد.",
                            )
                          }
                        >
                          رد تمدید
                        </Btn>
                      </div>
                    ) : null}
                  </form>

                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!withdrawReason.trim()) return;
                      void runAction(
                        `/crm/api/property-cases/${activeCase.id}/request_withdrawal/`,
                        { reason: withdrawReason.trim() },
                        "درخواست انصراف مشاور ثبت شد.",
                      );
                    }}
                    className="space-y-2 rounded-xl border p-3"
                  >
                    <strong className="text-xs font-semibold text-foreground">درخواست انصراف از پرونده</strong>
                    <input
                      value={withdrawReason}
                      onChange={(e) => setWithdrawReason(e.target.value)}
                      placeholder="علت انصراف مشاور"
                      className={inputCls}
                      required
                    />
                    <Btn type="submit" color="light" disabled={Boolean(pendingWd)}>
                      {pendingWd ? "درخواست انصراف در انتظار بررسی" : "ثبت درخواست انصراف"}
                    </Btn>
                    {pendingWd && isManager ? (
                      <div className="flex gap-2 pt-1">
                        <Btn
                          type="button"
                          onClick={() =>
                            void runAction(
                              `/crm/api/withdrawals/${String(pendingWd.id)}/decide/`,
                              { status: "APPROVED" },
                              "انصراف مشاور تأیید شد و پرونده به مرحلهٔ ارجاع بازگشت.",
                            )
                          }
                        >
                          تأیید انصراف
                        </Btn>
                        <Btn
                          type="button"
                          color="danger"
                          onClick={() =>
                            void runAction(
                              `/crm/api/withdrawals/${String(pendingWd.id)}/decide/`,
                              { status: "REJECTED", decision_reason: "ادامه توسط مشاور فعلی" },
                              "درخواست انصراف رد شد.",
                            )
                          }
                        >
                          رد انصراف
                        </Btn>
                      </div>
                    ) : null}
                  </form>
                </div>
              ) : null}

              <CaseManagementActions
                csrfToken={csrfToken}
                subject={activeCase as unknown as Row}
                subjectType="property_case"
                scopes={scopes}
                candidates={listItems as unknown as Row[]}
                enabled={isManager}
                onChanged={reload}
              />
            </Card>
          </div>

          <aside className="lg:col-span-4">
            <div className="lg:sticky lg:top-4">
              <CaseActivityPanel
                csrfToken={csrfToken}
                subject={activeCase as unknown as Row}
                subjectType="property_case"
              />
            </div>
          </aside>
        </div>

        <CaseHistoryModal
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          csrfToken={csrfToken}
          caseId={activeCase.id}
          caseCode={activeCase.code}
        />
      </Shell>
    );
  }

  return (
    <Shell
      title="پرونده‌های ثبت ملک"
      subtitle="پایش یکپارچهٔ سرنخ‌ها، کارشناسی‌ها، تأییدیه‌ها و فایل‌های عرضه بر اساس مرحلهٔ واقعی پرونده"
      error={error}
      loading={loading}
      onReload={reload}
      embedded={embedded}
    >
      {lastVisited ? (
        <div
          role="region"
          aria-label="آخرین بار اینجا بودید"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary px-2.5 py-0.5 font-bold text-primary-foreground">
              آخرین بار اینجا بودید
            </span>
            <strong className="text-sm text-foreground">{lastVisited.title}</strong>
            <span className="font-mono text-muted-foreground">({lastVisited.code})</span>
            {lastVisited.stageLabel ? (
              <span className="text-muted-foreground">· مرحله: {lastVisited.stageLabel}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Btn type="button" onClick={() => navigate("crm-property-cases", lastVisited.id)}>
              <span className="inline-flex items-center gap-1">
                ادامه از همین پرونده
                <ArrowLeft size={13} />
              </span>
            </Btn>
            <button
              type="button"
              onClick={() => {
                clearLastVisitedCase(userKey);
                setLastVisited(null);
              }}
              className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"
            >
              بستن یادآور
            </button>
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setStageFilter("")}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
              stageFilter === "" ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-secondary"
            }`}
          >
            همه ({formatFaInt(listItems.length, "۰")})
          </button>
          {STAGE_ORDER.map((stage) => (
            <button
              key={stage}
              type="button"
              onClick={() => setStageFilter(stage)}
              className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                stageFilter === stage ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-secondary"
              }`}
            >
              {STAGE_LABELS_FA[stage]} ({formatFaInt(stageCounts[stage] || 0, "۰")})
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border bg-card p-0.5" role="group" aria-label="تغییر نمای نمایش">
            <button
              type="button"
              aria-pressed={viewMode === "cards"}
              onClick={() => setViewMode("cards")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                viewMode === "cards" ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground"
              }`}
            >
              <LayoutGrid size={13} />
              کارت‌های مرحله‌ای
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "table"}
              onClick={() => setViewMode("table")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                viewMode === "table" ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground"
              }`}
            >
              <List size={13} />
              جدول
            </button>
          </div>
          <Btn type="button" onClick={() => navigate("crm-property-register")}>
            <span className="inline-flex items-center gap-1">
              <Plus size={14} />
              ثبت پرونده جدید
            </span>
          </Btn>
        </div>
      </div>

      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="جست‌وجو بر اساس کد پرونده، نام شخص، عنوان ملک، محله یا مشاور مسئول…"
      />

      {!filteredItems.length ? (
        <Card>
          <EmptyState
            title="پرونده‌ای با این فیلتر یافت نشد"
            description="فیلتر مرحله یا عبارت جست‌وجو را تغییر دهید یا یک پروندهٔ جدید ثبت کنید."
          />
        </Card>
      ) : viewMode === "cards" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((item) => {
            const stall = computeStallInfo(item);
            const caseMeta = supplyStatusBadgeMeta("case", item.status);
            return (
              <Card key={item.id} className="flex flex-col justify-between space-y-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-muted-foreground">{item.code}</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge label={STAGE_LABELS_FA[item.stage] || item.stage} variant="teal" dot />
                      {stall.isStalled ? <Badge label="راکد" variant="danger" /> : null}
                    </div>
                  </div>
                  <h3 className="text-sm font-bold text-foreground">
                    {item.property_title || item.description || item.contact_name || "بدون عنوان"}
                  </h3>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>مالک / متقاضی ثبت: {item.contact_name || "نامشخص"}</div>
                    <div>مشاور مسئول: {item.assigned_to_name || "تعیین‌نشده"}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} />
                        انتظار: {formatFaInt(stall.waitingDays, "۰")} روز
                      </span>
                      <span>·</span>
                      <span>
                        مهلت: {item.due_at ? new Date(item.due_at).toLocaleDateString("fa-IR") : "نامشخص"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5">
                  <Badge label={caseMeta.label} variant={caseMeta.variant} />
                  <div className="flex gap-1.5">
                    <Btn type="button" color="light" onClick={() => navigate("crm-property-register", item.id)}>
                      ویزارد
                    </Btn>
                    <Btn type="button" onClick={() => navigate("crm-property-cases", item.id)}>
                      باز کردن پرونده
                    </Btn>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-right text-xs">
            <thead className="border-b bg-secondary/60 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">کد پرونده</th>
                <th className="px-4 py-3 font-semibold">عنوان / شرح</th>
                <th className="px-4 py-3 font-semibold">شخص مرتبط</th>
                <th className="px-4 py-3 font-semibold">مرحله</th>
                <th className="px-4 py-3 font-semibold">مشاور مسئول</th>
                <th className="px-4 py-3 font-semibold">مهلت</th>
                <th className="px-4 py-3 font-semibold">انتظار</th>
                <th className="px-4 py-3 font-semibold">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredItems.map((item) => {
                const stall = computeStallInfo(item);
                return (
                  <tr key={item.id} className="hover:bg-secondary/40">
                    <td className="px-4 py-3 font-mono font-semibold">{item.code}</td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {item.property_title || item.description || "نامشخص"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{item.contact_name || "نامشخص"}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge label={STAGE_LABELS_FA[item.stage] || item.stage} variant="teal" dot />
                        {stall.isStalled ? <Badge label="راکد" variant="danger" /> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{item.assigned_to_name || "تعیین‌نشده"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.due_at ? new Date(item.due_at).toLocaleDateString("fa-IR") : "نامشخص"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {stall.isStalled ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-destructive">
                          <AlertTriangle size={12} />
                          {formatFaInt(stall.waitingDays, "۰")} روز
                        </span>
                      ) : (
                        <span>{formatFaInt(stall.waitingDays, "۰")} روز</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Btn type="button" color="light" onClick={() => navigate("crm-property-cases", item.id)}>
                        جزئیات
                      </Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </Shell>
  );
}

export const PropertyCases = PropertyCasesPage;

