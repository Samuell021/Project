import React from "react";
import { cx } from "../../lib/utils";
import type { BadgeV } from "../../lib/types";

function Badge({ label, variant = "default", dot, leadingIcon }: { label: string; variant?: BadgeV; dot?: boolean; leadingIcon?: React.ReactNode }) {
  const s: Record<BadgeV, string> = {
    default: "bg-secondary text-foreground",
    success: "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/35",
    warning: "bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/35",
    danger: "bg-red-50 dark:bg-red-500/12 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-500/35",
    info: "bg-blue-50 dark:bg-blue-500/12 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/35",
    purple: "bg-purple-50 dark:bg-purple-500/12 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/35",
    muted: "bg-muted text-muted-foreground",
    teal: "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-600 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/35",
  };
  const dc: Record<BadgeV, string> = { default: "bg-foreground", success: "bg-emerald-500", warning: "bg-amber-500", danger: "bg-red-500", info: "bg-blue-500", purple: "bg-purple-500", muted: "bg-muted-foreground", teal: "bg-emerald-500" };
  return (
    <span className={cx("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap", s[variant])}>
      {leadingIcon ? <span className="inline-flex flex-shrink-0">{leadingIcon}</span> : dot && <span className={cx("w-1.5 h-1.5 rounded-full flex-shrink-0", dc[variant])} />}
      {label}
    </span>
  );
}

export const toPersianType = (type?: string | null): string => {
  const map: Record<string, string> = {
    "Apartment": "آپارتمان", "APARTMENT": "آپارتمان", "apartment": "آپارتمان",
    "Villa": "ویلا", "VILLA": "ویلا", "villa": "ویلا",
    "Townhouse": "خانه ویلایی", "TOWNHOUSE": "خانه ویلایی", "townhouse": "خانه ویلایی",
    "Studio": "استودیو", "STUDIO": "استودیو", "studio": "استودیو",
    "Penthouse": "پنت‌هاوس", "PENTHOUSE": "پنت‌هاوس", "penthouse": "پنت‌هاوس",
    "Commercial": "تجاری/اداری", "COMMERCIAL": "تجاری/اداری", "commercial": "تجاری/اداری",
    "Office": "دفتر کار", "OFFICE": "دفتر کار", "office": "دفتر کار",
    "Shop": "مغازه", "SHOP": "مغازه", "shop": "مغازه",
    "Land": "زمین", "LAND": "زمین", "land": "زمین",
    "Other": "سایر", "OTHER": "سایر", "other": "سایر",
  };
  return map[String(type || "").trim()] || type || "—";
};

export const toPersianDeal = (deal?: string | null): string => {
  const map: Record<string, string> = {
    "Sale": "فروش", "SALE": "فروش", "sale": "فروش",
    "Rent": "اجاره", "RENT": "اجاره", "rent": "اجاره",
    "Off-Plan": "پیش‌فروش", "OFF_PLAN": "پیش‌فروش", "OFF-PLAN": "پیش‌فروش", "off-plan": "پیش‌فروش",
  };
  return map[String(deal || "").trim()] || deal || "—";
};

export const toPersianPropertyStatus = (st?: string | null): string => {
  const map: Record<string, string> = {
    "Available": "آماده واگذاری", "AVAILABLE": "آماده واگذاری", "available": "آماده واگذاری",
    "Reserved": "رزرو شده", "RESERVED": "رزرو شده", "reserved": "رزرو شده",
    "Sold": "فروخته‌/واگذارشده", "SOLD": "فروخته‌/واگذارشده", "sold": "فروخته‌/واگذارشده",
    "Rented": "اجاره‌داده‌شده", "RENTED": "اجاره‌داده‌شده", "rented": "اجاره‌داده‌شده",
    "Inactive": "بایگانی‌شده", "INACTIVE": "بایگانی‌شده", "inactive": "بایگانی‌شده",
    "Draft": "پیش‌نویس", "DRAFT": "پیش‌نویس", "draft": "پیش‌نویس",
  };
  return map[String(st || "").trim()] || st || "آماده واگذاری";
};

export const toPersianPropertyFileStatus = (st?: string | null): string => {
  const map: Record<string, string> = {
    "Draft": "پیش‌نویس", "DRAFT": "پیش‌نویس", "draft": "پیش‌نویس",
    "Pending Approval": "در انتظار تایید", "PENDING_APPROVAL": "در انتظار تایید", "PENDING APPROVAL": "در انتظار تایید",
    "Published": "منتشرشده (فعال)", "PUBLISHED": "منتشرشده (فعال)", "ACTIVE": "منتشرشده (فعال)", "active": "منتشرشده (فعال)",
    "Paused": "متوقف‌شده", "PAUSED": "متوقف‌شده", "paused": "متوقف‌شده",
    "Expired": "منقضی‌شده", "EXPIRED": "منقضی‌شده", "expired": "منقضی‌شده",
    "Inactive": "بایگانی‌شده", "INACTIVE": "بایگانی‌شده", "ARCHIVED": "بایگانی‌شده", "Archived": "بایگانی‌شده",
  };
  return map[String(st || "").trim()] || st || "—";
};

export const toPersianTaskType = (type?: string | null): string => {
  const map: Record<string, string> = {
    "Viewing": "بازدید ملک", "VIEWING": "بازدید ملک", "viewing": "بازدید ملک",
    "Document": "بررسی مدارک", "DOCUMENT": "بررسی مدارک", "document": "بررسی مدارک",
    "Negotiation": "مذاکره و نشست", "NEGOTIATION": "مذاکره و نشست", "negotiation": "مذاکره و نشست",
    "Follow-Up": "پیگیری مستمر", "FOLLOW_UP": "پیگیری مستمر", "Follow-up": "پیگیری مستمر", "follow_up": "پیگیری مستمر",
    "Administrative": "امور اداری و دفتری", "ADMINISTRATIVE": "امور اداری و دفتری", "administrative": "امور اداری و دفتری",
    "Site Visit": "کارشناسی میدانی", "SITE_VISIT": "کارشناسی میدانی", "site_visit": "کارشناسی میدانی", "Site visit": "کارشناسی میدانی",
    "Contract": "عقد قرارداد", "CONTRACT": "عقد قرارداد", "contract": "عقد قرارداد",
    "Inspection": "بازرسی فنی", "INSPECTION": "بازرسی فنی", "inspection": "بازرسی فنی",
  };
  return map[String(type || "").trim()] || type || "—";
};

export const toPersianTaskStatus = (st?: string | null): string => {
  const map: Record<string, string> = {
    "Pending": "در انتظار انجام", "PENDING": "در انتظار انجام", "pending": "در انتظار انجام",
    "In Progress": "در حال انجام", "IN_PROGRESS": "در حال انجام", "IN PROGRESS": "در حال انجام", "in_progress": "در حال انجام",
    "Completed": "تکمیل‌شده", "COMPLETED": "تکمیل‌شده", "completed": "تکمیل‌شده",
    "Cancelled": "لغوشده", "CANCELLED": "لغوشده", "cancelled": "لغوشده",
  };
  return map[String(st || "").trim()] || st || "—";
};

export const toPersianPriority = (p?: string | null): string => {
  const map: Record<string, string> = {
    "Low": "اولویت کم", "LOW": "اولویت کم", "low": "اولویت کم", "1": "اولویت کم",
    "Medium": "اولویت عادی", "MEDIUM": "اولویت عادی", "medium": "اولویت عادی", "2": "اولویت عادی",
    "High": "اولویت بالا", "HIGH": "اولویت بالا", "high": "اولویت بالا", "3": "اولویت بالا",
    "Urgent": "اولویت فوری", "URGENT": "اولویت فوری", "urgent": "اولویت فوری", "4": "اولویت فوری",
  };
  return map[String(p || "").trim()] || p || "عادی";
};

export const toPersianFollowupType = (type?: string | null): string => {
  const map: Record<string, string> = {
    "Call": "تماس تلفنی", "CALL": "تماس تلفنی", "call": "تماس تلفنی",
    "Meeting": "جلسه حضوری", "MEETING": "جلسه حضوری", "meeting": "جلسه حضوری",
    "Email": "ارسال پیام/ایمیل", "EMAIL": "ارسال پیام/ایمیل", "email": "ارسال پیام/ایمیل",
    "Site Visit": "بازدید میدانی ملک", "SITE VISIT": "بازدید میدانی ملک", "SITE_VISIT": "بازدید میدانی ملک", "site_visit": "بازدید میدانی ملک",
  };
  return map[String(type || "").trim()] || type || "—";
};

export const toPersianChannel = (ch?: string | null): string => {
  const map: Record<string, string> = {
    "WEBSITE": "پرتال رسمی زمینکس", "Website": "پرتال رسمی زمینکس", "وب‌سایت": "پرتال رسمی زمینکس",
    "INSTAGRAM": "صفحه اینستاگرام", "Instagram": "صفحه اینستاگرام", "اینستاگرام": "صفحه اینستاگرام",
    "TELEGRAM": "کانال تلگرام", "Telegram": "کانال تلگرام", "تلگرام": "کانال تلگرام",
    "OTHER": "سایر کانال‌های بازاریابی", "Other": "سایر کانال‌های بازاریابی", "سایر": "سایر کانال‌های بازاریابی",
  };
  return map[String(ch || "").trim()] || ch || "—";
};

export { Badge };
