export const faNum = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString("fa-IR") : String(value);
};

export const stageLabels: Record<string, string> = {
  LEAD: "پذیرش سرنخ",
  ASSIGNMENT: "ارجاع",
  ACCEPTANCE: "پذیرش مسئول",
  APPRAISAL: "کارشناسی",
  REVIEW: "بررسی مدیر",
  PROPERTY_FILE: "فایل عرضه",
  NEEDS: "تکمیل نیاز",
  INTRODUCTION: "معرفی فایل",
  VIEWING: "بازدید",
  NEGOTIATION: "مذاکره",
  COMPLETED: "تکمیل‌شده",
  CLOSED: "بسته",
  DUPLICATE: "تکراری",
};

