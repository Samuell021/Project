import type { CSSProperties } from "react";

const PAGE_SIZE = 20;
const TRANSACTION_TYPES = ["Sale", "Rent", "Off-Plan"];
const PROPERTY_STATUSES = ["Available", "Reserved", "Sold", "Inactive", "Draft"];

const PROPERTY_STATUS_TO_BACKEND: Record<string, string> = {
  Available: "AVAILABLE",
  Reserved: "RESERVED",
  Sold: "SOLD",
  Inactive: "INACTIVE",
  Draft: "DRAFT",
};

const PROPERTY_FILE_STATUSES = ["Draft", "Pending Approval", "Published", "Expired", "Inactive"];
const TASK_TYPES = ["Viewing", "Document", "Negotiation", "Follow-Up", "Administrative", "Site Visit", "Contract", "Inspection"];
const TASK_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
const TASK_PRIORITIES = ["Low", "Medium", "High", "Urgent"];

const DASH_AREA = [
  { month: "تیر", revenue: 4.2, forecast: 4.8 }, { month: "مرداد", revenue: 5.1, forecast: 5.0 },
  { month: "شهریور", revenue: 3.8, forecast: 5.2 }, { month: "مهر", revenue: 6.9, forecast: 6.0 },
  { month: "آبان", revenue: 8.2, forecast: 7.5 }, { month: "آذر", revenue: 11.4, forecast: 10.0 },
];
const CHANNEL_PIE = [{ name: "پرتال Property Finder", value: 48 }, { name: "پرتال Bayut", value: 35 }, { name: "پرتال Dubizzle", value: 17 }];
const PIE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
];
const DELEGATION_COLORS = {
  selfManaged: "var(--chart-1)",
  delegated: "var(--chart-2)",
  unassigned: "var(--muted-foreground)",
};

const CHART_GRID_COLOR = "var(--border)";
const CHART_AXIS_COLOR = "var(--muted-foreground)";
const CHART_NEUTRAL_COLOR = "var(--border-strong)";

const CHART_TOOLTIP_STYLE: CSSProperties = {
  fontSize: 12,
  borderRadius: 12,
  padding: "8px 12px",
  backgroundColor: "var(--card)",
  border: "1px solid var(--border-strong)",
  color: "var(--foreground)",
  boxShadow: "var(--shadow-lg)",
};

const CHART_STATUS_SERIES: Record<string, string> = {
  PENDING: "var(--muted-foreground)",
  IN_PROGRESS: "var(--chart-3)",
  COMPLETED: "var(--chart-1)",
  CANCELLED: "var(--chart-5)",
  DRAFT: "var(--muted-foreground)",
  ACTIVE: "var(--chart-1)",
  PAUSED: "var(--chart-3)",
  SOLD: "var(--chart-5)",
  EXPIRED: "var(--chart-4)",
  ARCHIVED: "var(--switch-background)",
};

const SKILL_RADAR = [
  { skill: "مذاکره و نشست", value: 88 }, { skill: "پیگیری مستمر", value: 72 }, { skill: "فایل‌یابی و فایل", value: 91 },
  { skill: "مدیریت کاریز", value: 65 }, { skill: "ارتباط با مشتری", value: 84 }, { skill: "بستن معامله", value: 79 },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const PERSIAN_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

const WEEKDAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه"];

const FOLLOWUP_TYPE_LABELS: Record<string, string> = {
  Call: "تماس تلفنی",
  Meeting: "جلسه حضوری",
  Email: "ارسال پیام/ایمیل",
  "Site Visit": "بازدید میدانی ملک",
};

export {
  CHART_AXIS_COLOR,
  CHART_COLORS,
  CHART_GRID_COLOR,
  CHART_NEUTRAL_COLOR,
  CHART_STATUS_SERIES,
  CHART_TOOLTIP_STYLE,
  PAGE_SIZE,
  TRANSACTION_TYPES,
  PROPERTY_STATUSES,
  PROPERTY_STATUS_TO_BACKEND,
  PROPERTY_FILE_STATUSES,
  TASK_TYPES,
  TASK_STATUSES,
  TASK_PRIORITIES,
  DASH_AREA,
  CHANNEL_PIE,
  PIE_COLORS,
  SKILL_RADAR,
  DELEGATION_COLORS,
  PAGE_SIZE_OPTIONS,
  PERSIAN_MONTHS,
  WEEKDAYS,
  FOLLOWUP_TYPE_LABELS,
};
