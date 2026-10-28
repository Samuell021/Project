import type { Page } from "../../shared/lib/types";

export type GuideEntity = {
  title: string;
  summary: string;
  relations: string[];
};

export type GuideFlow = {
  title: string;
  steps: string[];
  guardrails: string[];
};

export type GuidePageRow = {
  page: Page;
  label: string;
  owner: string;
  flow: string;
  acceptance: string;
  code: string;
};

export type GuideRules = string[];

export const GUIDE_ENTITIES: GuideEntity[] = [
  {
    title: "شخص و راه تماس",
    summary: "شخص موجودیت مستقل از حساب کاربری است؛ هر شخص چند شماره دارد و شماره نرمال‌شده درون یک شخص تکرار نمی‌شود.",
    relations: ["شخص ← شماره‌ها", "شخص ← مالکیت و طرفیت ملک", "شخص ← درخواست متقاضی", "شخص ← پرونده ثبت ملک"],
  },
  {
    title: "دارایی و طرف‌های آن",
    summary: "مالک، مستأجر و طرف‌های ملک رابطه زمان‌دار دارند و مالک پیشین با پایان دوره حفظ می‌شود. قیمت و نوع معامله روی خود ملک نگهداری نمی‌شود.",
    relations: ["ملک ← طرف‌ها", "ملک ← کارشناسی و بررسی", "ملک ← فایل عرضه", "قیمت خواندنی ← عرضه فعال"],
  },
  {
    title: "فایل عرضه و نسخه",
    summary: "هر فایل عرضه شرایط نسخه‌دار دارد؛ تغییر معتبر نسخه تازه می‌سازد و نسخه پیشین بازنویسی نمی‌شود.",
    relations: ["فایل عرضه ← نوع معامله منتشرشده", "فایل عرضه ← شرایط", "فایل عرضه ← نسخه‌های تغییرناپذیر", "فایل عرضه ← معرفی و بازدید"],
  },
  {
    title: "پرونده و مرحله",
    summary: "مرحله از رکوردهای واقعی محاسبه می‌شود؛ تغییر مرحله فقط با فرمان مجاز و ثبت تاریخچه انجام می‌شود.",
    relations: ["پرونده ← نسخه‌ها", "پرونده ← ارجاع و پذیرش", "پرونده ← تمدید و انصراف", "پرونده ← کارشناسی و بررسی"],
  },
  {
    title: "رنج، گروه و مجوز",
    summary: "رنج مرجع حوزه داده است؛ عضویت بازه زمانی دارد و مجوز از گروه‌های کاربر خوانده می‌شود، نه از فهرست موازی.",
    relations: ["رنج ← عضویت‌های زمان‌دار", "رنج ← پرونده و درخواست", "کاربر ← عضویت فعال", "گروه ← کدهای مجوز"],
  },
  {
    title: "نوع معامله و نسخه",
    summary: "هر نوع معامله نسخه منتشرشده و طرح شرایط دارد؛ عرضه و قرارداد فقط با نسخه منتشرشده معتبر ساخته می‌شوند.",
    relations: ["نوع معامله ← نسخه‌ها", "نسخه ← طرح شرایط", "نسخه ← فایل عرضه", "نسخه ← شرایط قرارداد"],
  },
  {
    title: "قرارداد و مالی",
    summary: "قرارداد طرفین، امضا، پیوست و اصلاحیه دارد؛ مبالغ عدد صحیح تومان‌اند و تخصیص وجه با مانده مطالبه و سهم کنترل می‌شود.",
    relations: ["مذاکره ← قرارداد", "قرارداد ← پیوست و اصلاحیه", "سیاست نسخه‌دار ← مطالبه", "مطالبه ← سهم و وجه", "وجه ← تخصیص و برگشت"],
  },
];

export const GUIDE_FLOWS: GuideFlow[] = [
  {
    title: "ثبت ملک تا فایل فعال",
    steps: ["ثبت سرنخ با شخص و راه تماس", "پذیرش مدیر و ارجاع با موعد", "پذیرش مسئول و کارشناسی", "ارسال برای بررسی با snapshot نسخه", "تأیید یا برگشت ملک", "ساخت فایل عرضه و فعال‌سازی با نسخه نوع معامله"],
    guardrails: ["تأیید ملک فایلی نمی‌سازد", "فایل متوقف با تأیید فعال نمی‌شود", "برگشت ملک عرضه‌های فعال را متوقف می‌کند"],
  },
  {
    title: "متقاضی تا قرارداد قطعی",
    steps: ["ثبت درخواست و نیاز هر نوع معامله", "تطبیق خواندنی بدون اثر جانبی", "معرفی صریح با snapshot شرایط", "زمان‌بندی بازدید و اتصال وظیفه", "شروع مذاکره پس از بازدید مثبت", "تنظیم قرارداد و امضای طرفین", "قطعی‌سازی توسط مدیر کل"],
    guardrails: ["جست‌وجو معرفی نمی‌سازد", "مذاکره بدون بازدید مثبت آغاز نمی‌شود", "قرارداد قطعی متعارض روی همان ملک مجاز نیست"],
  },
  {
    title: "مالی و برخورد با برگشت",
    steps: ["ساخت مطالبه از قرارداد قطعی", "محاسبه از نسخه سیاست منتشرشده", "تأیید مطالبه و سهم‌ها", "ثبت دریافت و تخصیص جزئی", "پرداخت سهم ذی‌نفعان", "ثبت سند برگشت در صورت نیاز"],
    guardrails: ["سند تأییدشده حذف نمی‌شود", "جمع تخصیص از مانده بیشتر نمی‌شود", "برگشت دوباره همان سند پذیرفته نمی‌شود"],
  },
];

export const GUIDE_PAGES: GuidePageRow[] = [
  { page: "admin-dashboard", label: "نمای کلی", owner: "مدیر کل و مدیر رنج", flow: "شاخص‌های بازه انتخابی و صف اقدام", acceptance: "بازه الزامی است و شمارنده‌ها از رکوردهای مجاز خوانده می‌شوند.", code: "src/features/crm/pages/ReportsPage.tsx" },
  { page: "my-tasks", label: "کارهای من", owner: "همه نقش‌ها", flow: "فهرست، تخته و تقویم یک منبع", acceptance: "تکمیل عمومی نتیجه تخصصی بازدید و پیگیری را دور نمی‌زند.", code: "src/features/tasks/pages/MyTasksPage.tsx" },
  { page: "crm-inbox", label: "کارتابل پذیرش", owner: "مدیر رنج", flow: "پذیرش سرنخ، ارجاع، تمدید و انصراف", acceptance: "تصمیم روی نسخه جاری و با دلیل ثبت می‌شود.", code: "src/features/crm/pages/InboxPage.tsx" },
  { page: "activity", label: "اعلان‌ها و سوابق", owner: "همه نقش‌ها", flow: "اعلان شخصی و سابقه فعالیت", acceptance: "بازه و نوع در نشانی صفحه حفظ می‌شود و پیوند مقصد کار می‌کند.", code: "src/features/activity/pages/NotificationsRecordsPage.tsx" },
  { page: "crm-contacts", label: "اشخاص", owner: "مشاور و مدیر", flow: "ثبت شخص، شماره و روابط", acceptance: "شماره نرمال‌شده و یکتا درون شخص است.", code: "src/features/crm/pages/ContactsPage.tsx" },
  { page: "crm-inquiry-register", label: "ثبت درخواست متقاضی", owner: "مشاور", flow: "ویزارد نیاز و بودجه", acceptance: "نیاز هر نوع معامله جدا ثبت می‌شود.", code: "src/features/crm/pages/InquiryRegisterPage.tsx" },
  { page: "crm-property-cases", label: "پرونده‌های ثبت ملک", owner: "مشاور مسئول", flow: "کارشناسی، بررسی و پیگیری", acceptance: "نسخه ارسال‌شده با نسخه بررسی‌شده مقایسه می‌شود.", code: "src/features/crm/pages/PropertyCasesPage.tsx" },
  { page: "crm-inquiries", label: "درخواست متقاضیان", owner: "مشاور مسئول", flow: "نیاز، تطبیق، معرفی و بازدید", acceptance: "معرفی فقط با انتخاب صریح فایل فعال.", code: "src/features/crm/pages/InquiriesPage.tsx" },
  { page: "properties", label: "املاک", owner: "مشاور و مدیر", flow: "دارایی، طرف‌ها، رسانه و اسناد", acceptance: "قیمت از فایل عرضه و مالک از طرف‌های ملک خوانده می‌شود.", code: "src/features/properties/PropertiesPage.tsx" },
  { page: "property-files", label: "فایل‌های عرضه", owner: "مشاور و مدیر", flow: "ساخت فایل، فعال‌سازی و تغییر قیمت", acceptance: "یکتایی ملک و نوع معامله و نسخه شرایط.", code: "src/features/propertyFiles/pages/PropertyFilesPage.tsx" },
  { page: "crm-reviews", label: "صف بررسی", owner: "مدیر رنج", flow: "تأیید یا برگشت ملک", acceptance: "عنوان هنگام تأیید و دلیل هنگام برگشت الزامی است.", code: "src/features/crm/pages/ReviewsQueuePage.tsx" },
  { page: "property-files-explore", label: "اکسپلور فایل‌های عرضه", owner: "مشاور", flow: "جست‌وجو در عرضه معتبر", acceptance: "اطلاعات خصوصی مالک نمایش داده نمی‌شود.", code: "src/features/propertyFiles/pages/PropertyFilesPage.tsx" },
  { page: "crm-pipelines", label: "کاریز عملیات", owner: "مدیر و مسئول", flow: "شش کاریز با فرمان صفحه رکورد", acceptance: "انتقال نامعتبر با دلیل فارسی رد می‌شود.", code: "src/features/crm/pages/PipelinesPage.tsx" },
  { page: "crm-introductions", label: "معرفی‌ها", owner: "مسئول نیاز", flow: "معرفی با snapshot و بازخورد", acceptance: "بازخورد بدون علاقه دلیل می‌خواهد.", code: "src/features/crm/pages/IntroductionsPage.tsx" },
  { page: "crm-viewings", label: "بازدیدها و تقویم", owner: "مسئول بازدید", flow: "زمان‌بندی و ثبت نتیجه", acceptance: "هر بازدید وظیفه هم‌زمان دارد و نتیجه وظیفه را می‌بندد.", code: "src/features/crm/pages/ViewingsPage.tsx" },
  { page: "follow-ups", label: "پیگیری‌ها", owner: "مشاور", flow: "ثبت، تعویق و تکمیل", acceptance: "تعویق دلیل و اقدام بعدی می‌خواهد.", code: "src/features/followups/pages/FollowUpsPage.tsx" },
  { page: "tickets-received", label: "تیکت‌ها", owner: "همه نقش‌ها", flow: "ارسال، پاسخ و وضعیت", acceptance: "پیوند موضوع و اعلان ثبت می‌شود.", code: "src/features/tickets/pages/TicketsPage.tsx" },
  { page: "crm-deals", label: "مذاکرات", owner: "مسئول مذاکره", flow: "توافق یا عدم توافق", acceptance: "عدم توافق دلیل می‌خواهد و فقط از بازدید مثبت آغاز می‌شود.", code: "src/features/crm/pages/DealsPage.tsx" },
  { page: "crm-contracts", label: "قراردادها", owner: "مدیر کل", flow: "شرایط، امضا، قطعی‌سازی و اصلاحیه", acceptance: "قطعی‌سازی با نسخه جاری و نبود مورد ناقص.", code: "src/features/crm/pages/ContractsPage.tsx" },
  { page: "crm-finance", label: "کمیسیون و وجوه", owner: "مالی", flow: "سیاست، مطالبه، وصول و برگشت", acceptance: "تخصیص از مانده بیشتر نمی‌شود و برگشت سند جدید می‌سازد.", code: "src/features/crm/pages/FinancePage.tsx" },
  { page: "crm-reports", label: "گزارش‌ها", owner: "مدیر و مالی", flow: "داشبورد نقش‌محور و گزارش تفکیک‌شده", acceptance: "ارزش معامله از مطالبه و وصول جدا گزارش می‌شود.", code: "src/features/crm/pages/ReportsPage.tsx" },
  { page: "consultants", label: "کارکنان", owner: "مدیر", flow: "پروفایل، نقش و عضویت", acceptance: "هویت کارمند از شخص جدا است.", code: "src/features/consultants/pages/ConsultantsPage.tsx" },
  { page: "settings-permissions", label: "گروه‌ها و سطح دسترسی", owner: "مدیر کل", flow: "مجوز گروه‌ها", acceptance: "مجوز در سرور و رابط هر دو اعمال می‌شود.", code: "src/features/settings/pages/SettingsPage.tsx" },
  { page: "settings-ranges", label: "رنج‌ها و تیم‌ها", owner: "مدیر کل", flow: "عضویت زمان‌دار و انتقال حوزه", acceptance: "مسئول خارج از حوزه به‌صورت امن پاک می‌شود.", code: "src/features/settings/pages/SettingsPage.tsx" },
  { page: "crm-deal-types", label: "انواع معامله", owner: "مدیر کل", flow: "نسخه، شرایط و انتشار", acceptance: "نسخه منتشرشده بازنویسی نمی‌شود.", code: "src/features/crm/pages/DealTypesPage.tsx" },
  { page: "manage-districts", label: "اطلاعات پایه", owner: "مدیر کل", flow: "مناطق، ویژگی‌ها و انواع ملک", acceptance: "داده مرجع تکراری ساخته نمی‌شود.", code: "src/features/districts/pages/DistrictsPage.tsx" },
  { page: "settings-workspace", label: "تنظیمات فضای کاری", owner: "مدیر کل", flow: "شرکت، تم، ورود و جریان", acceptance: "تغییر تنظیمات اثر مشخص و اعتبارسنجی دارد.", code: "src/features/settings/pages/SettingsPage.tsx" },
  { page: "consultant-dashboard", label: "داشبورد مشاور", owner: "مشاور", flow: "کارهای باز، پیگیری و گزارش شخصی", acceptance: "فقط داده مجاز همان مشاور نمایش داده می‌شود.", code: "src/features/dashboard/pages/ConsultantDashboard.tsx" },
  { page: "create-followup", label: "ثبت پیگیری", owner: "مشاور", flow: "فرم ثبت پیگیری از صفحه رکورد", acceptance: "پیگیری بدون موضوع و موعد ثبت نمی‌شود.", code: "src/features/followups/components/CreateFollowUp.tsx" },
  { page: "create-ticket", label: "ثبت تیکت", owner: "همه نقش‌ها", flow: "پیوند موضوع، اولویت و متن", acceptance: "تیکت بدون موضوع مرتبط و متن ثبت نمی‌شود.", code: "src/features/tickets/pages/TicketsPage.tsx" },
  { page: "tasks-kanban", label: "تخته کارها", owner: "همه نقش‌ها", flow: "تغییر وضعیت وظیفه", acceptance: "همان فرمان فهرست وظایف اجرا می‌شود.", code: "src/features/tasks/pages/TasksWorkspacePage.tsx" },
  { page: "tasks-calendar", label: "تقویم کارها", owner: "همه نقش‌ها", flow: "نمای ماهانه شمسی وظایف", acceptance: "سررسید و وضعیت روی همان وظیفه اعمال می‌شود.", code: "src/features/tasks/pages/TasksWorkspacePage.tsx" },
  { page: "create-task", label: "افزودن کار", owner: "همه نقش‌ها", flow: "ثبت وظیفه از تخته", acceptance: "وظیفه پس از ثبت در همان تخته دیده می‌شود.", code: "src/features/tasks/pages/TasksWorkspacePage.tsx" },
  { page: "add-consultant", label: "افزودن کاربر", owner: "مدیر", flow: "ساخت پروفایل، نقش و عضویت", acceptance: "شماره تکراری کاربر تازه نمی‌سازد.", code: "src/features/consultants/components/AddConsultantPage.tsx" },
  { page: "manage-attributes", label: "ویژگی‌های ملک", owner: "مدیر کل", flow: "تعریف ویژگی و گزینه", acceptance: "ویژگی غیرفعال از فرم ملک حذف می‌شود.", code: "src/features/attributes/pages/AttributesPage.tsx" },
  { page: "settings-login-options", label: "گزینه‌های ورود", owner: "مدیر کل", flow: "رمز یا پیامک و تنظیمات پیامک", acceptance: "تغییر روش ورود برای کاربران اعمال می‌شود.", code: "src/features/settings/pages/SettingsPage.tsx" },
  { page: "crm-settings", label: "تنظیمات جریان کار", owner: "مدیر کل", flow: "آستانه توقف و مهلت‌ها", acceptance: "مقدار ذخیره‌شده در گزارش و کاریز همان لحظه اثر می‌گذارد.", code: "src/features/crm/pages/CrmSettingsPage.tsx" },
  { page: "my-profile", label: "پروفایل من", owner: "همه نقش‌ها", flow: "مشاهده پروفایل", acceptance: "داده هویتی از پروفایل کارمند خوانده می‌شود.", code: "src/features/profile/pages/MyProfilePage.tsx" },
  { page: "my-profile-edit", label: "ویرایش پروفایل", owner: "همه نقش‌ها", flow: "تغییر مشخصات", acceptance: "تغییر با نسخه و اعتبارسنجی ذخیره می‌شود.", code: "src/features/profile/pages/MyProfilePage.tsx" },
  { page: "my-profile-security", label: "امنیت حساب", owner: "همه نقش‌ها", flow: "تغییر رمز", acceptance: "تغییر رمز رویداد اعلان ثبت می‌کند.", code: "src/features/profile/pages/MyProfilePage.tsx" },
  { page: "guide", label: "راهنمای ساختار", owner: "همه نقش‌ها", flow: "مرجع مدل‌ها، جریان‌ها و قواعد", acceptance: "محتوا از یک فایل داده تولید می‌شود.", code: "src/features/guide/GuidePage.tsx" },
  { page: "add-property", label: "ثبت پرونده", owner: "مشاور", flow: "ویزارد ثبت پرونده و ادامه پیش‌نویس", acceptance: "پیش‌نویس نسخه‌دار و ادامه پرونده بدون تکرار؛ تنها ورودی سایدبار برای این صفحه.", code: "src/features/crm/pages/PropertyRegisterPage.tsx" },
  { page: "create-property-file", label: "ساخت فایل عرضه", owner: "مشاور", flow: "ویزارد فایل روی ملک تأییدشده", acceptance: "فایل فقط روی ملک تأییدشده با مسئول فعال ساخته می‌شود.", code: "src/features/propertyFiles/components/CreatePropertyFileWizard.tsx" },
];

export const GUIDE_RULES: GuideRules = [
  "ذخیره تاریخ به‌صورت استاندارد و نمایش به وقت تهران است.",
  "مبلغ به عدد صحیح تومان ذخیره می‌شود و اعشار پذیرفته نیست.",
  "هر تغییر نسخه دارد؛ تعارض نسخه با پاسخ ۴۰۹ و پیام فارسی گزارش می‌شود.",
  "فرمان‌های تکرارپذیر کلید Idempotency-Key و رسید فرمان دارند.",
  "دسترسی داده در سرور و رابط کاربری از گروه مجوز و عضویت رنج خوانده می‌شود.",
  "وضعیت‌های نمایشی از یک مرجع مرکزی می‌آیند و برچسب محلی ندارند.",
  "مبلغ نامشخص «نامشخص» نمایش داده می‌شود و هرگز صفر یا جمع مبهم نیست.",
];
