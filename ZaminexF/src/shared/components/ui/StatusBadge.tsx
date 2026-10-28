import React from "react";
import { Circle, CircleCheck, Clock3, XCircle } from "lucide-react";
import { Badge } from "./Badge";
import type { BadgeV } from "../../lib/types";

type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
type TaskStatusPresentation = {
  status: TaskStatus;
  label: string;
  variant: BadgeV;
  icon: "pending" | "inProgress" | "completed" | "cancelled";
};

const TASK_STATUS_PRESENTATIONS: Record<TaskStatus, TaskStatusPresentation> = {
  PENDING: { status: "PENDING", label: "در انتظار انجام", variant: "muted", icon: "pending" },
  IN_PROGRESS: { status: "IN_PROGRESS", label: "در حال انجام", variant: "warning", icon: "inProgress" },
  COMPLETED: { status: "COMPLETED", label: "تکمیل‌شده", variant: "success", icon: "completed" },
  CANCELLED: { status: "CANCELLED", label: "لغوشده", variant: "danger", icon: "cancelled" },
};

const STATUS_MAP: Record<string, { label: string; variant: BadgeV }> = {
  AVAILABLE: { label: "آماده واگذاری", variant: "success" },
  RESERVED: { label: "رزرو شده", variant: "info" },
  SOLD: { label: "فروخته‌/واگذارشده", variant: "muted" },
  RENTED: { label: "اجاره‌داده‌شده", variant: "purple" },
  INACTIVE: { label: "بایگانی‌شده", variant: "muted" },
  NOT_SUBMITTED: { label: "تکمیل‌نشده", variant: "muted" },
  PENDING_REVIEW: { label: "در انتظار بررسی", variant: "warning" },
  APPROVED: { label: "تأییدشده", variant: "success" },
  CHANGES_REQUIRED: { label: "نیازمند اصلاح", variant: "danger" },
  CLOSED: { label: "بسته", variant: "muted" },
  DUPLICATE: { label: "تکراری", variant: "warning" },
  DRAFT: { label: "پیش‌نویس", variant: "warning" },
  PUBLISHED: { label: "منتشرشده (فعال)", variant: "info" },
  ACTIVE: { label: "فعال", variant: "info" },
  PENDING_APPROVAL: { label: "در انتظار بررسی", variant: "warning" },
  PAUSED: { label: "متوقف", variant: "warning" },
  EXPIRED: { label: "منقضی‌شده", variant: "danger" },
  ARCHIVED: { label: "بایگانی‌شده", variant: "muted" },
  URGENT: { label: "اولویت فوری", variant: "danger" },
  HIGH: { label: "اولویت بالا", variant: "warning" },
  MEDIUM: { label: "اولویت عادی", variant: "info" },
  LOW: { label: "اولویت کم", variant: "muted" },
  CALL: { label: "تماس تلفنی", variant: "info" },
  MEETING: { label: "جلسه حضوری", variant: "purple" },
  EMAIL: { label: "ارسال پیام/ایمیل", variant: "muted" },
  SITE_VISIT: { label: "بازدید میدانی ملک", variant: "teal" },
  SCHEDULED: { label: "برنامه‌ریزی‌شده", variant: "purple" },
  UPDATE: { label: "بروزرسانی", variant: "info" },
  CREATE: { label: "ایجاد", variant: "success" },
  SUBMIT: { label: "ارسال", variant: "purple" },
  COMPLETE: { label: "تکمیل", variant: "success" },
  EXPORT: { label: "خروجی", variant: "muted" },
  ARCHIVE: { label: "بایگانی", variant: "warning" },
  SYSTEM: { label: "سیستمی", variant: "muted" },
};

function getTaskStatusPresentation(status: string | null | undefined): TaskStatusPresentation | null {
  const key = String(status || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (key === "PENDING" || key === "IN_PROGRESS" || key === "COMPLETED" || key === "CANCELLED") {
    return TASK_STATUS_PRESENTATIONS[key];
  }
  return null;
}

const TASK_STATUS_MARKERS = {
  pending: { className: "text-muted-foreground", strokeWidth: 2.2 },
  inProgress: { className: "text-amber-500 dark:text-amber-300", strokeWidth: 2.6 },
  completed: { className: "text-emerald-600 dark:text-emerald-300", strokeWidth: 2.6 },
  cancelled: { className: "text-red-600 dark:text-red-300", strokeWidth: 2.6 },
};

function TaskStatusIcon({ status, size = 14 }: { status: string; size?: number }) {
  const presentation = getTaskStatusPresentation(status);
  if (!presentation) return null;
  const marker = TASK_STATUS_MARKERS[presentation.icon];
  const props = {
    size,
    className: marker.className,
    strokeWidth: marker.strokeWidth,
    "aria-hidden": true as const,
  };
  if (presentation.icon === "pending") return <Circle {...props} />;
  if (presentation.icon === "inProgress") return <Clock3 {...props} />;
  if (presentation.icon === "completed") return <CircleCheck {...props} />;
  return <XCircle {...props} />;
}

function statusBadge(status: string) {
  const taskStatus = getTaskStatusPresentation(status);
  if (taskStatus) {
    return <Badge label={taskStatus.label} variant={taskStatus.variant} leadingIcon={<TaskStatusIcon status={taskStatus.status} />} />;
  }
  const raw = String(status || "").trim();
  const normalized = raw.replace(/[\s-]+/g, "_").toUpperCase();
  const cfg = STATUS_MAP[normalized] ?? { label: raw, variant: "default" as BadgeV };
  return <Badge label={cfg.label} variant={cfg.variant} dot />;
}

export { getTaskStatusPresentation, statusBadge, TaskStatusIcon };
