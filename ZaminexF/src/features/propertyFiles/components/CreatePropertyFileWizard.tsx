import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cx } from "../../../shared/lib/utils";
import { Page, Role, Property, PropertyFile, FollowUp, ConsultantItem, BadgeV } from "../../../shared/lib/types";
import { fmtShort, toPersianType, toPersianDeal, toPersianPropertyStatus, toPersianTaskStatus, toPersianTaskType, toPersianPriority, toPersianChannel, propertyStatusToUI, toPersianFollowupType, toPersianPropertyFileStatus } from "../../../shared/lib/utils";
import { Badge } from "../../../shared/components/ui/Badge";
import { Btn } from "../../../shared/components/ui/Btn";
import { Input } from "../../../shared/components/ui/Input";
import { JalaliDateInput } from "../../../shared/components/ui/JalaliDateInput";
import { Card } from "../../../shared/components/ui/Card";
import { SelectField } from "../../../shared/components/ui/SelectField";
import { ProfileAvatar } from "../../../shared/components/ui/ProfileAvatar";
import { KpiCard } from "../../../shared/components/ui/KpiCard";
import { EmptyState } from "../../../shared/components/ui/EmptyState";
import { PageHeader } from "../../../shared/components/ui/PageHeader";
import { ConfirmModal } from "../../../shared/components/ConfirmModal";
import { ActionMenu } from "../../../shared/components/ActionMenu";
import { Pagination } from "../../../shared/components/Pagination";
import { BulkActionBar } from "../../../shared/components/BulkActionBar";
import { PropertyCombobox } from "../../../shared/components/ui/PropertyCombobox";
import { ConsultantCombobox } from "../../../shared/components/ui/ConsultantCombobox";
import { DistrictCombobox } from "../../../shared/components/ui/DistrictCombobox";
import { MultiPropertyCombobox } from "../../../shared/components/ui/MultiPropertyCombobox";
import { MultiConsultantCombobox } from "../../../shared/components/ui/MultiConsultantCombobox";
import { usePermissions } from "../../../shared/lib/permissions";
import { apiFetch, readJson, apiErrorMessage, getCsrfToken } from "../../../shared/lib/apiClient";
import { toast, requiredFieldMsg, normalizePriceDigits } from "../../../shared/lib/utils";
import { DynamicAttributeFields } from "../../../shared/components/ui/DynamicAttributeFields";
import { useBasicsCatalog, useAttributeSchema } from "../../../shared/lib/useAttributeSchema";
import { DealTypeListCombobox } from "../../../shared/components/ui/DealTypeListCombobox";
import { Building2, LayoutDashboard, FileText, CheckSquare, Users, BarChart3, Settings, Bell, Search, LogOut, Plus, ChevronLeft, ChevronDown, ChevronRight, Clock, CheckCircle2, AlertCircle, MoreHorizontal, MapPin, Eye, Edit2, Trash2, Archive, Phone, Mail, Calendar, TrendingUp, Activity, Command, Star, List, LayoutGrid, Download, Shield, User, Lock, Key, RefreshCw, Circle, Zap, Target, Award, Upload, Check, AlertTriangle, Info, XCircle, Loader2, CircleCheck, TriangleAlert, Columns, Send, BellRing, X, ChevronUp, SlidersHorizontal, ArrowUpRight, Layers, MessageSquare, Sparkles, GripVertical, MoreVertical, Building, History, Flame, Image, Filter } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, ReferenceLine, ScatterChart, Scatter, ZAxis, RadialBarChart, RadialBar } from "recharts";
function CreatePropertyFileWizard({ 
  navigate, 
  role, 
  preselectedPropertyId, 
  currentConsultantId,
  currentConsultant, 
  consultants, 
  properties,
  editingPropertyFile,
  onSubmit,
  isSubmitting,
  submitError,
  csrfToken
}: { 
  navigate: (p: Page) => void; 
  role?: Role; 
  preselectedPropertyId?: string; 
  currentConsultantId?: string | null;
  currentConsultant?: any;  
  consultants: ConsultantItem[]; 
  properties: Property[];
  editingPropertyFile?: PropertyFile;
  onSubmit: (payload: Record<string, any>, id?: string | null) => Promise<{ ok: boolean; data?: any }>;
  isSubmitting: boolean;
  submitError: string | null;
  csrfToken?: string;
}) {
  const isEditMode = !!editingPropertyFile;
  const { can } = usePermissions();
  const canAssign = can("property_file.assign");
  const isConsultant = role === "consultant";
  const [step, setStep] = useState(1);
  const propertyLocked = isEditMode;
  const total = 3;
  const labels = ["اطلاعات پایه", "ملک و معامله", "انتشار و بررسی"];

  const [form, setForm] = useState({
    title: editingPropertyFile?.title || "", 
    description: editingPropertyFile?.description || "", 
    propertyId: editingPropertyFile?.property || preselectedPropertyId || "",
    priority: editingPropertyFile?.priority ? String(editingPropertyFile.priority) : "2",
    createdBy: editingPropertyFile?.created_by || "",
    assignedTo: editingPropertyFile?.assigned_to || "",
    publish_channel: editingPropertyFile?.publishChannel || "WEBSITE", 
    start_date: editingPropertyFile?.start_date ? editingPropertyFile.start_date.split("T")[0] : "", 
    end_date: editingPropertyFile?.end_date ? editingPropertyFile.end_date.split("T")[0] : "",
    is_featured: editingPropertyFile?.is_featured || false,
    dealType: (editingPropertyFile as any)?.dealType ? String((editingPropertyFile as any).dealType) : "",
    salePrice: normalizePriceDigits((editingPropertyFile as any)?.salePrice),
    deposit: normalizePriceDigits((editingPropertyFile as any)?.deposit),
    monthlyRent: normalizePriceDigits((editingPropertyFile as any)?.monthlyRent),
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const REQUIRED_LABELS: Record<string, string> = { title: "عنوان فایل", propertyId: "ملک", dealType: "نوع معامله" };
  const requiredForStep = (s: number): string[] => {
    if (s === 1) return ["title"];
    if (s === 2) return ["propertyId", "dealType"];
    return [];
  };
  const clearFieldError = (k: string) => setFieldErrors((p) => { if (!p[k]) return p; const n = { ...p }; delete n[k]; return n; });
  const set = (k: string, v: any) => { setForm((p) => ({ ...p, [k]: v })); clearFieldError(k); };
  const validateStep = (s: number): boolean => {
    const errs: Record<string, string> = {};
    requiredForStep(s).forEach((k) => {
      if (!String((form as Record<string, any>)[k] ?? "").trim()) errs[k] = requiredFieldMsg(REQUIRED_LABELS[k]);
    });
    if (s === 2) {
      const checkPositivePrice = (key: string, rawVal: any) => {
        const str = String(rawVal ?? "").trim();
        if (!str) return;
        const cleaned = normalizePriceDigits(str);
        if (!cleaned || Number(cleaned) <= 0) {
          errs[key] = "مبلغ واردشده باید بیشتر از صفر باشد.";
        }
      };
      if (showSalePrice) checkPositivePrice("salePrice", form.salePrice);
      if (showDeposit) checkPositivePrice("deposit", form.deposit);
      if (showRent) checkPositivePrice("monthlyRent", form.monthlyRent);
      (schema?.fields ?? []).forEach((f) => {
        if (f.inputType === "price" || Boolean(f.unit && f.unit.includes("تومان"))) {
          checkPositivePrice(f.name, attributes[f.name]);
        }
      });
    }
    setFieldErrors((prev) => {
      const next = { ...prev };
      requiredForStep(s).forEach((k) => { delete next[k]; });
      if (s === 2) {
        delete next.salePrice;
        delete next.deposit;
        delete next.monthlyRent;
        (schema?.fields ?? []).forEach((f) => {
          if (f.inputType === "price" || Boolean(f.unit && f.unit.includes("تومان"))) {
            delete next[f.name];
          }
        });
      }
      return { ...next, ...errs };
    });
    return Object.keys(errs).length === 0;
  };
  const goNextStep = () => { if (validateStep(step)) setStep(step + 1); };
  const validateAllRequired = (): boolean => {
    for (const s of [1, 2]) {
      if (!validateStep(s)) { setStep(s); return false; }
    }
    return true;
  };

  const consultantProperties = useMemo(() => {
    if (!isConsultant) return properties;
    const uid = String(currentConsultant?.user?.id ?? currentConsultant?.id ?? currentConsultantId ?? "");
    if (!uid) return [];
    return properties.filter(
      (p) => String(p.consultantId ?? p.consultant ?? "") === uid
    );
  }, [role, properties, currentConsultant, currentConsultantId]);

  const listableProperties = useMemo(() => {
    const currentId = String(form.propertyId ?? "");
    return consultantProperties.filter((p) => {
      const st = String((p as any).propertyStatus ?? (p as any).status ?? "").toUpperCase();
      return st === "AVAILABLE" || String(p.id) === currentId;
    });
  }, [consultantProperties, form.propertyId]);

  useEffect(() => {
    if (!canAssign) {
      const uid = String(currentConsultant?.user?.id ?? currentConsultant?.id ?? currentConsultantId ?? "");
      if (uid) {
        setForm((p) => ({
          ...p,
          createdBy: !isEditMode ? (p.createdBy || uid) : p.createdBy,
          assignedTo: uid,
        }));
      }
    }
  }, [canAssign, currentConsultant, currentConsultantId, isEditMode]);

  const selectedProp = properties.find((p) => String(p.id) === String(form.propertyId));

  useEffect(() => {
    const suggestedTitle = selectedProp?.title;
    if (isEditMode || !suggestedTitle) return;
    setForm((current) =>
      current.title.trim() ? current : { ...current, title: suggestedTitle }
    );
  }, [isEditMode, selectedProp?.title]);

  const { catalog } = useBasicsCatalog(csrfToken);
  const { schema, loading: schemaLoading } = useAttributeSchema("propertyFile", form.dealType, csrfToken);
  const [attributes, setAttributes] = useState<Record<string, unknown>>(
    ((editingPropertyFile as unknown as { attributes?: Record<string, unknown> })?.attributes) || {}
  );
  const [dealSwitchNotice, setDealSwitchNotice] = useState<string | null>(null);
  const setAttribute = (name: string, value: unknown) => {
    setAttributes((p) => ({ ...p, [name]: value }));
    clearFieldError(name);
  };

  const handleDealTypeChange = (nextDealId: string) => {
    const prevDeal = catalog?.dealTypes?.find((d) => String(d.id) === String(form.dealType));
    const nextDeal = catalog?.dealTypes?.find((d) => String(d.id) === String(nextDealId));
    const hadPricing = Boolean(
      form.salePrice || form.deposit || form.monthlyRent || Object.keys(attributes).some((k) => attributes[k] !== "" && attributes[k] != null)
    );
    if (form.dealType && form.dealType !== nextDealId && hadPricing) {
      const nextCode = nextDeal?.name ?? "";
      const keepRent = nextCode === "mortgage_rent";
      const keepDeposit = nextCode === "mortgage_rent" || nextCode === "full_mortgage";
      const keepSale = ["sale", "presale", "exchange", "partnership"].includes(nextCode) || (Boolean(nextCode) && !keepDeposit && !keepRent);
      const removedLabels: string[] = [];
      if (form.salePrice && !keepSale) removedLabels.push("قیمت کل");
      if (form.deposit && !keepDeposit) removedLabels.push("ودیعه");
      if (form.monthlyRent && !keepRent) removedLabels.push("اجاره ماهانه");
      const attrCount = Object.keys(attributes).filter((k) => attributes[k] !== "" && attributes[k] != null).length;
      if (attrCount > 0) removedLabels.push("شرایط اختصاصی نوع معامله قبلی");
      setForm((p) => ({
        ...p,
        dealType: nextDealId,
        salePrice: keepSale ? p.salePrice : "",
        deposit: keepDeposit ? p.deposit : "",
        monthlyRent: keepRent ? p.monthlyRent : "",
      }));
      setAttributes({});
      clearFieldError("dealType");
      setDealSwitchNotice(
        removedLabels.length > 0
          ? `با تغییر نوع معامله از «${prevDeal?.title || "قبلی"}» به «${nextDeal?.title || "جدید"}»، فیلدهای ناسازگار (${removedLabels.join("، ")}) پاک‌سازی شدند تا بدون خطا شرایط جدید ثبت شود.`
          : null
      );
      return;
    }
    setDealSwitchNotice(null);
    set("dealType", nextDealId);
  };

  const selectedDeal = useMemo(
    () => catalog?.dealTypes?.find((d) => String(d.id) === String(form.dealType)),
    [catalog, form.dealType]
  );

  const dealName = selectedDeal?.name ?? "";
  const showRent = dealName === "mortgage_rent";
  const showDeposit = dealName === "mortgage_rent" || dealName === "full_mortgage";
  const showSalePrice =
    ["sale", "presale", "exchange", "partnership"].includes(dealName) ||
    (Boolean(dealName) && !showDeposit && !showRent);

  const ownerUserId = selectedProp?.consultantId ? String(selectedProp.consultantId) : "";
  const ownerProfile = consultants.find((c) => String(c.user?.id || c.id) === ownerUserId);
  const ownerRole = (ownerProfile?.user?.role ?? ownerProfile?.role ?? "").toString().toUpperCase();
  const autoAssignOwner = canAssign && !isEditMode && !!ownerUserId && !!ownerProfile && (!ownerRole || ownerRole === "AGENT");

  useEffect(() => {
    if (!autoAssignOwner) return;
    setForm((p) => (String(p.assignedTo) === ownerUserId ? p : { ...p, assignedTo: ownerUserId }));
  }, [autoAssignOwner, ownerUserId]);

  const handleFinish = async () => {
    if (!validateAllRequired()) return;
    const cleanSalePrice = normalizePriceDigits(form.salePrice);
    const cleanDeposit = normalizePriceDigits(form.deposit);
    const cleanMonthlyRent = normalizePriceDigits(form.monthlyRent);
    const payload = {
      title: form.title,
      description: form.description,
      property: Number(form.propertyId),
      priority: Number(form.priority),
      created_by: form.createdBy ? Number(form.createdBy) : undefined,
      assigned_to: form.assignedTo ? Number(form.assignedTo) : undefined,
      publishChannel: form.publish_channel,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      is_featured: form.is_featured,
      dealType: form.dealType ? Number(form.dealType) : null,
      salePrice: showSalePrice && cleanSalePrice && Number(cleanSalePrice) > 0 ? Number(cleanSalePrice) : null,
      deposit: showDeposit && cleanDeposit && Number(cleanDeposit) > 0 ? Number(cleanDeposit) : null,
      monthlyRent: showRent && cleanMonthlyRent && Number(cleanMonthlyRent) > 0 ? Number(cleanMonthlyRent) : null,
      attributes,
    };

    const res = await onSubmit(payload, isEditMode ? String(editingPropertyFile!.id) : null);
    if (res.ok) {
      const savedAsDraft = String(res.data?.status || "").toUpperCase() === "DRAFT";
      const message = isEditMode
        ? savedAsDraft
          ? "فایل عرضه به صورت پیش‌نویس ذخیره شد."
          : "فایل عرضه با موفقیت ویرایش شد."
        : savedAsDraft
          ? "فایل عرضه به صورت پیش‌نویس ثبت شد."
          : "فایل عرضه با موفقیت ثبت و فعال شد.";
      toast({ type: "success", message });
      navigate(isConsultant ? "my-property-files" : "property-files");
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-1.5 mb-6 text-xs text-muted-foreground">
        <button onClick={() => navigate(role === "consultant" ? "my-property-files" : "property-files")} className="hover:text-foreground">فایل‌ها</button>
        <ChevronRight size={12} /><span className="text-foreground font-medium">{isEditMode ? "ویرایش فایل" : "ساخت فایل"}</span>
      </div>

      <div className="flex items-center gap-0 mb-8">
        {labels.map((label, i) => {
          const n = i + 1; const done = n < step; const active = n === step;
          return (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div className={cx("w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all", done ? "bg-emerald-500 text-white" : active ? "bg-primary text-primary-foreground shadow-md shadow-primary/30" : "bg-secondary text-muted-foreground border border-border")}>
                  {done ? <Check size={14} /> : n}
                </div>
                <span className={cx("text-xs mt-1 whitespace-nowrap font-medium", active ? "text-primary" : done ? "text-emerald-600 dark:text-emerald-300" : "text-muted-foreground")}>{label}</span>
              </div>
              {i < labels.length - 1 && <div className={cx("flex-1 h-0.5 mx-2 mb-4 rounded-full", done ? "bg-emerald-400" : "bg-border")} />}
            </div>
          );
        })}
      </div>

      {submitError && <div className="p-3 mb-4 rounded-xl bg-red-50 dark:bg-red-500/12 text-xs text-red-600 dark:text-red-300 border border-red-200 dark:border-red-500/35">{submitError}</div>}

      <Card className="p-6">
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold mb-1">اطلاعات پایه</h2>
            <Input label="عنوان فایل" placeholder="مثال: آپارتمان ۳ خوابه سعادت‌آباد با چشم‌انداز عالی" value={form.title} onChange={(v) => set("title", v)} error={fieldErrors.title} required />
            <Input label="توضیحات" placeholder="این فایل را توصیف کنید..." value={form.description} onChange={(v) => set("description", v)} textarea rows={5} />
            <SelectField label="اولویت" value={form.priority} onChange={(v) => set("priority", v)} 
              options={[{ label: "کم", value: "1" }, { label: "عادی", value: "2" }, { label: "بالا", value: "3" }, { label: "فوری", value: "4" }]} required />
            <div className="flex items-start gap-3 p-3 rounded-xl border border-border hover:border-primary/30 cursor-pointer" onClick={() => set("is_featured", !form.is_featured)}>
              <input type="checkbox" checked={form.is_featured} onChange={() => {}} className="rounded mt-0.5" />
              <div><p className="text-sm font-medium">فایل ویژه</p><p className="text-xs text-muted-foreground">در بالای نتایج پرتال نمایش داده می‌شود</p></div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold mb-1">انتخاب ملک</h2>
            <PropertyCombobox
              label="ملک" value={String(form.propertyId ?? "")} onChange={(v) => set("propertyId", v)}
              locked={propertyLocked} lockedLabel={selectedProp?.title} error={fieldErrors.propertyId} required properties={listableProperties}
            />
            {selectedProp && (
              <div className="p-4 bg-secondary rounded-xl border border-border">
                <p className="text-sm font-semibold">{selectedProp.title}</p>
                <p className="text-xs text-muted-foreground">{selectedProp.district} | کد: {selectedProp.internalCode}</p>
              </div>
            )}
            <DealTypeListCombobox
              label="نوع معامله"
              value={form.dealType}
              onChange={handleDealTypeChange}
              options={(catalog?.dealTypes ?? []).map((d) => ({ id: d.id, displayName: d.displayName, name: d.name }))}
              placeholder="انتخاب نوع معامله"
              error={fieldErrors.dealType}
              required
            />
            {dealSwitchNotice && (
              <div role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/12 px-3.5 py-2.5 text-xs text-foreground">
                {dealSwitchNotice}
              </div>
            )}
            {(showSalePrice || showDeposit || showRent) && (
              <div className="grid grid-cols-2 gap-4">
                {showSalePrice && (
                  <Input label="قیمت فروش (تومان)" isPrice placeholder="مبلغ به تومان" value={form.salePrice} onChange={(v) => set("salePrice", v)} error={fieldErrors.salePrice} />
                )}
                {showDeposit && (
                  <Input label={dealName === "mortgage_rent" ? "مبلغ ودیعه (تومان)" : "مبلغ رهن (تومان)"} isPrice placeholder="مبلغ به تومان" value={form.deposit} onChange={(v) => set("deposit", v)} error={fieldErrors.deposit} />
                )}
                {showRent && (
                  <Input label="اجاره ماهانه (تومان)" isPrice placeholder="مبلغ به تومان" value={form.monthlyRent} onChange={(v) => set("monthlyRent", v)} error={fieldErrors.monthlyRent} />
                )}
              </div>
            )}
            <DynamicAttributeFields
              schema={schema}
              values={attributes}
              onChange={setAttribute}
              errors={fieldErrors}
              loading={schemaLoading}
            />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold mb-1">اطلاعات انتشار</h2>
            <SelectField label="کانال انتشار" value={form.publish_channel} onChange={(v) => set("publish_channel", v)} 
              options={[{ label: "وب‌سایت", value: "WEBSITE" }, { label: "اینستاگرام", value: "INSTAGRAM" }, { label: "تلگرام", value: "TELEGRAM" }, { label: "سایر", value: "OTHER" }]} required />
            <div className="grid grid-cols-2 gap-4">
              <JalaliDateInput label="تاریخ شروع" value={form.start_date} onChange={(v) => set("start_date", v)} />
              <JalaliDateInput label="تاریخ پایان" value={form.end_date} onChange={(v) => set("end_date", v)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">واگذار به</label>
              {!canAssign ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted px-3.5 py-2.5 opacity-75 cursor-not-allowed">
                    <ProfileAvatar imageUrl={currentConsultant?.profile_image} initials={(currentConsultant?.full_name || currentConsultant?.user?.first_name || "C").slice(0, 2).toUpperCase()} size="xs" />
                    <span className="flex-1 text-sm font-medium text-foreground truncate">
                      {currentConsultant?.full_name || `${currentConsultant?.user?.first_name || ""} ${currentConsultant?.user?.last_name || ""}`.trim() || currentConsultant?.user?.username || "کارشناس جاری"}
                    </span>
                    <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                      خودکار
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">فایل‌ها به‌طور خودکار به حساب شما واگذار می‌شوند و قابل تغییر نیست.</p>
                </div>
              ) : (
                <ConsultantCombobox value={String(form.assignedTo ?? "")} onChange={(v) => set("assignedTo", v)} disabled={autoAssignOwner} consultants={consultants} />
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 border-t border-border pt-5 mt-5">
            <h2 className="text-base font-semibold mb-1">بررسی نهایی</h2>
            <div className="rounded-xl bg-secondary p-4 space-y-3">
              {[
                ["عنوان", form.title || "بدون عنوان"],
                ["ملک", selectedProp?.title || "— انتخاب نشده —"],
                ["نوع معامله", selectedDeal?.displayName === "رهن و اجاره" ? "اجاره" : selectedDeal?.displayName || "—"],
                ...(showSalePrice && form.salePrice ? [["قیمت فروش", fmtShort(Number(form.salePrice))] as [string, string]] : []),
                ...(showDeposit && form.deposit ? [[dealName === "mortgage_rent" ? "ودیعه" : "رهن", fmtShort(Number(form.deposit))] as [string, string]] : []),
                ...(showRent && form.monthlyRent ? [["اجاره ماهانه", fmtShort(Number(form.monthlyRent))] as [string, string]] : []),
                ["کانال", toPersianChannel(form.publish_channel)],
                ["تاریخ شروع", form.start_date || "فوری"],
                ["اولویت", form.priority === "4" ? "فوری" : form.priority === "3" ? "بالا" : form.priority === "1" ? "کم" : "عادی"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-1.5 border-b border-border/50 last:border-0">
                  <span className="text-sm text-muted-foreground">{k}</span>
                  <span className="text-sm font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <div className="flex justify-between mt-4">
        <Btn variant="secondary" onClick={() => step > 1 ? setStep(step - 1) : navigate(isConsultant ? "my-property-files" : "property-files")}><ChevronRight size={14} />{step > 1 ? "قبلی" : "انصراف"}</Btn>
        {step < total
          ? <Btn variant="primary" onClick={goNextStep}>ادامه <ChevronLeft size={14} /></Btn>
          : <Btn variant="primary" disabled={isSubmitting} onClick={handleFinish}>{isSubmitting ? "در حال ثبت…" : "ثبت فایل"}</Btn>
        }
      </div>
    </div>
  );
}


export { CreatePropertyFileWizard };
