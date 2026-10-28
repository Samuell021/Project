import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cx } from "../../../shared/lib/utils";
import { Page, Role, Property, PropertyFile, FollowUp, ConsultantItem, BadgeV } from "../../../shared/lib/types";
import { fmtShort, toPersianType, toPersianDeal, toPersianPropertyStatus, toPersianTaskStatus, toPersianTaskType, toPersianPriority, toPersianChannel, propertyStatusToUI, toPersianFollowupType } from "../../../shared/lib/utils";
import { Badge } from "../../../shared/components/ui/Badge";
import { Btn } from "../../../shared/components/ui/Btn";
import { Input } from "../../../shared/components/ui/Input";
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
import { usePermissions } from "../../../shared/lib/permissions";
import { apiFetch, readJson, apiErrorMessage, getCsrfToken } from "../../../shared/lib/apiClient";
import { toast, requiredFieldMsg, validateCoordinatePair, ownerPhoneError, normalizePhone } from "../../../shared/lib/utils";
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis } from "recharts";
import { Building2, FileText, CheckSquare, BellRing, Users, Activity, Settings, Plus, RefreshCw, Eye, Edit2, Trash2, Archive, Clock, MapPin, Check, X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, SlidersHorizontal, ArrowUpRight, LayoutGrid, List, Download, Search, MoreVertical, Phone, Mail, Calendar, TrendingUp, Star, Shield, Lock, Key, Send, Loader2, AlertTriangle, Info, XCircle, CheckCircle2, TriangleAlert, Columns, MessageSquare, Sparkles, GripVertical, Building, History, Flame, Image, Zap, LayoutDashboard, Command, Filter, Award, BarChart3, Layers, User, UserRound, Upload } from "lucide-react";
import { TRANSACTION_TYPES } from "../../../shared/lib/constants";
import { DynamicAttributeFields } from "../../../shared/components/ui/DynamicAttributeFields";
import { LocationSelect, useLocationTree } from "../../../shared/components/ui/LocationSelect";
import { PropertyMapPicker } from "../../../shared/components/ui/PropertyMapPicker";
import { useBasicsCatalog, useAttributeSchema } from "../../../shared/lib/useAttributeSchema";
import { formatJalali } from "../../../shared/lib/jdate";

const MAX_PROPERTY_IMAGES = 30;
const MAX_PROPERTY_IMAGE_SIZE = 5 * 1024 * 1024;
const PROPERTY_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PROPERTY_IMAGE_EXTENSION_PATTERN = /\.(jpe?g|png|webp)$/i;

function AddPropertyWizard({
  navigate,
  role,
  onSubmit,
  onUploadImages,
  isSubmitting,
  submitError,
  consultants,
  districtsList = [],
  properties = [],
  csrfToken,
}: {
  navigate: (p: Page) => void;
  role: Role;
  onSubmit: (payload: Record<string, any>, propertyId?: string | null) => Promise<any>;
  districtsList?: string[];
  onUploadImages: (propertyId: string, files: File[]) => Promise<any>;
  isSubmitting: boolean;
  submitError: string | null;
  consultants: ConsultantItem[];
  properties?: Property[];
  csrfToken?: string;
}) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ title: "", internalCode: "", propertyTypeRef: "", beds: "", area: "", floor: "", constructionYear: "", provinceId: "", cityId: "", districtId: "", latitude: "", longitude: "", fullAddress: "", description: "", consultant: "", ownerFirstName: "", ownerLastName: "", ownerPhone: "" });
  const [gallery, setGallery] = useState<File[]>([]);
  const [galleryPreviews, setGalleryPreviews] = useState<{ file: File; url: string }[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { catalog } = useBasicsCatalog(csrfToken);
  const { tree: locationTree } = useLocationTree(csrfToken);
  const { schema, loading: schemaLoading } = useAttributeSchema("property", form.propertyTypeRef, csrfToken);
  const [attributes, setAttributes] = useState<Record<string, any>>({});
  const setAttribute = (name: string, value: any) => {
    setAttributes((p) => ({ ...p, [name]: value }));
    clearFieldError(name);
  };

  useEffect(() => {
    const previews = gallery.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setGalleryPreviews(previews);
    return () => previews.forEach(({ url }) => URL.revokeObjectURL(url));
  }, [gallery]);

  useEffect(() => { setAttributes({}); }, [form.propertyTypeRef]);

  useEffect(() => {
    if (!form.propertyTypeRef && catalog?.propertyTypes?.length) {
      setForm((p) => ({ ...p, propertyTypeRef: String(catalog.propertyTypes[0].id) }));
    }
  }, [catalog, form.propertyTypeRef]);

  useEffect(() => {
    if (!csrfToken) return;
    let cancelled = false;
    apiFetch("/properties/api/properties/next-internal-code/", { method: "GET" }, csrfToken)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.internalCode) {
          setForm((p) => ({ ...p, internalCode: data.internalCode }));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [csrfToken]);

  const { can } = usePermissions();
  const canAssignProperty = can("property.assign");
  const isStaff = role !== "consultant";
  const total = 4;
  const labels = ["اطلاعات پایه", "جزئیات", "موقعیت", "رسانه و بررسی نهایی"];
  const propertiesPage = isStaff ? "properties" : "my-properties";

  const REQUIRED_LABELS: Record<string, string> = {
    title: "عنوان ملک",
    internalCode: "کد داخلی",
    propertyTypeRef: "نوع ملک",
    area: "مساحت (متر مربع)",
    provinceId: "استان",
    cityId: "شهر",
    districtId: "محله",
    fullAddress: "آدرس کامل",
    consultant: "واگذار به کارشناس",
    ownerFirstName: "نام مالک",
    ownerLastName: "نام خانوادگی مالک",
    ownerPhone: "شماره موبایل مالک",
  };
  const OWNER_REQUIRED = ["ownerFirstName", "ownerLastName", "ownerPhone"];
  const requiredForStep = (s: number): string[] => {
    if (s === 1) {
      return canAssignProperty
        ? ["title", "propertyTypeRef", "consultant", ...OWNER_REQUIRED]
        : ["title", "propertyTypeRef", ...OWNER_REQUIRED];
    }
    if (s === 2) return ["area"];
    if (s === 3) return ["provinceId", "cityId", "districtId", "fullAddress"];
    return [];
  };
  const clearFieldError = (k: string) => setFieldErrors((p) => { if (!p[k]) return p; const n = { ...p }; delete n[k]; return n; });
  const set = (k: string, v: string) => { setForm((p) => ({ ...p, [k]: v })); clearFieldError(k); };

  const selectedType = useMemo(
    () => catalog?.propertyTypes?.find((t) => String(t.id) === String(form.propertyTypeRef)),
    [catalog, form.propertyTypeRef]
  );
  const selectedUsageLabel = selectedType?.propertyUsageName ?? "—";

  const selectedDistrictLabel = useMemo(() => {
    const province = locationTree.find((p) => String(p.id) === String(form.provinceId));
    const city = province?.cities.find((c) => String(c.id) === String(form.cityId));
    const district = city?.districts.find((d) => String(d.id) === String(form.districtId));
    if (!district) return "—";
    return `${province!.displayName} / ${city!.displayName} / ${district.displayName}`;
  }, [locationTree, form.provinceId, form.cityId, form.districtId]);

  const selectedLocationNames = useMemo(() => {
    const province = locationTree.find((p) => String(p.id) === String(form.provinceId));
    const city = province?.cities.find((c) => String(c.id) === String(form.cityId));
    const district = city?.districts.find((d) => String(d.id) === String(form.districtId));
    return {
      provinceName: province?.displayName || "",
      cityName: city?.displayName || "",
      districtName: district?.displayName || "",
    };
  }, [locationTree, form.provinceId, form.cityId, form.districtId]);

  const reviewAttributeRows = useMemo<[string, string][]>(() => {
    if (!schema) return [];
    return [...schema.fields, ...schema.facilities]
      .filter((f) => !f.isCore)
      .map((f) => {
        const raw = attributes[f.name];
        if (raw === undefined || raw === null || raw === "" || raw === false) return null;
        let text: string;
        if (typeof raw === "boolean") text = "بله";
        else if (Array.isArray(raw)) {
          text = raw.map((v) => f.options.find((o) => o.value === v)?.displayName ?? v).join("، ");
        } else if (f.dataType === "select") {
          text = f.options.find((o) => o.value === raw)?.displayName ?? String(raw);
        } else if (f.dataType === "date") {
          text = formatJalali(String(raw));
        } else {
          text = f.unit ? `${raw} ${f.unit}` : String(raw);
        }
        return [f.displayName, text] as [string, string];
      })
      .filter(Boolean) as [string, string][];
  }, [schema, attributes]);
  const validateStep = (s: number): boolean => {
    const errs: Record<string, string> = {};
    requiredForStep(s).forEach((k) => {
      if (!String((form as Record<string, any>)[k] ?? "").trim()) errs[k] = requiredFieldMsg(REQUIRED_LABELS[k]);
    });
    if (s === 1) {
      const phoneErr = ownerPhoneError(form.ownerPhone);
      if (phoneErr) errs["ownerPhone"] = phoneErr;
    }
    setFieldErrors((prev) => {
      const next = { ...prev };
      requiredForStep(s).forEach((k) => { delete next[k]; });
      delete next.internalCode;
      return { ...next, ...errs };
    });
    return Object.keys(errs).length === 0;
  };
  const goNextStep = () => { if (validateStep(step)) setStep(step + 1); };

  const validateAttributes = (): boolean => {
    if (!schema) return true;
    const errs: Record<string, string> = {};
    [...schema.fields, ...schema.facilities]
      .filter((f) => f.isRequired && !f.isCore)
      .forEach((f) => {
        const v = attributes[f.name];
        if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
          errs[f.name] = requiredFieldMsg(f.displayName);
        }
      });
    setFieldErrors((prev) => ({ ...prev, ...errs }));
    return Object.keys(errs).length === 0;
  };

  const validateAllRequired = (): boolean => {
    for (const s of [1, 2, 3]) {
      if (!validateStep(s)) { setStep(s); return false; }
    }
    if (!validateAttributes()) { setStep(2); return false; }
    return true;
  };

  const [coordError, setCoordError] = useState<string | null>(null);
  const handleConfirmCoordinates = () => {
    const result = validateCoordinatePair(form.latitude, form.longitude);
    if (result.state === "empty") {
      setCoordError("برای تایید، هر دو مختصات را وارد کنید یا موقعیت را از روی نقشه انتخاب کنید.");
      return;
    }
    if (result.state === "invalid") {
      setCoordError(result.error);
      return;
    }
    setCoordError(null);
    setForm((p) => ({ ...p, latitude: String(result.value[0]), longitude: String(result.value[1]) }));
  };

  const mapFormToPayload = () => ({
    title: form.title,
    internalCode: form.internalCode,
    propertyTypeRef: form.propertyTypeRef ? Number(form.propertyTypeRef) : null,
    beds: form.beds ? Number(form.beds) : null,
    area: form.area ? Number(form.area) : null,
    floor: form.floor ? Number(form.floor) : null,
    constructionYear: form.constructionYear ? Number(form.constructionYear) : null,
    districtId: form.districtId ? Number(form.districtId) : null,
    latitude: form.latitude ? Number(form.latitude) : null,
    longitude: form.longitude ? Number(form.longitude) : null,
    fullAddress: form.fullAddress,
    description: form.description,
    consultant: form.consultant || null,
    ownerFirstName: form.ownerFirstName,
    ownerLastName: form.ownerLastName,
    ownerPhone: normalizePhone(form.ownerPhone),
    attributes,
  });

  const handleCreateSubmit = async () => {
    if (!validateAllRequired()) return;
    const result = await onSubmit(mapFormToPayload());

    if (!result?.ok) return;

    const createdId = String(result.data.id);

    let imageUploadFailed = false;
    if (gallery.length > 0) {
      try {
        await onUploadImages(createdId, gallery);
      } catch {
        imageUploadFailed = true;
      }
    }

    toast({
      type: imageUploadFailed ? "error" : "success",
      message: imageUploadFailed
        ? "ملک ذخیره شد، اما بارگذاری تصویرها کامل نشد. از گالری همین ملک دوباره تلاش کنید."
        : !canAssignProperty
          ? "ملک با موفقیت ثبت شد و تا تأیید مدیر به‌صورت پیش‌نویس می‌ماند."
          : "ملک با موفقیت ثبت شد.",
    });
    navigate(imageUploadFailed ? "property-detail" : propertiesPage);
  };

  const handleSaveDraft = async () => {
    if (!canAssignProperty) return;
    const errors: Record<string, string> = {};
    if (!form.title.trim()) errors.title = requiredFieldMsg("عنوان ملک");
    if (!form.consultant) errors.consultant = requiredFieldMsg("واگذار به کارشناس");
    setFieldErrors((previous) => ({ ...previous, ...errors }));
    if (Object.keys(errors).length) return;

    const payload: Record<string, any> = {
      title: form.title.trim(),
      consultant: Number(form.consultant),
      status: "DRAFT",
    };
    if (form.propertyTypeRef) payload.propertyTypeRef = Number(form.propertyTypeRef);
    if (form.beds.trim()) payload.beds = Number(form.beds);
    if (form.area.trim()) payload.area = Number(form.area);
    if (form.floor.trim()) payload.floor = Number(form.floor);
    if (form.constructionYear.trim()) payload.constructionYear = Number(form.constructionYear);
    if (form.districtId) payload.districtId = Number(form.districtId);
    if (form.fullAddress.trim()) payload.fullAddress = form.fullAddress.trim();
    if (form.description.trim()) payload.description = form.description.trim();
    if (form.ownerFirstName.trim()) payload.ownerFirstName = form.ownerFirstName.trim();
    if (form.ownerLastName.trim()) payload.ownerLastName = form.ownerLastName.trim();
    if (form.ownerPhone.trim()) payload.ownerPhone = normalizePhone(form.ownerPhone);
    if (form.latitude.trim() && form.longitude.trim()) {
      payload.latitude = Number(form.latitude);
      payload.longitude = Number(form.longitude);
    }
    if (Object.keys(attributes).length) payload.attributes = attributes;

    const result = await onSubmit(payload);
    if (!result?.ok) return;

    const createdId = String(result.data.id);
    let imageUploadFailed = false;
    if (gallery.length > 0) {
      try {
        await onUploadImages(createdId, gallery);
      } catch {
        imageUploadFailed = true;
      }
    }
    toast({
      type: imageUploadFailed ? "error" : "success",
      message: imageUploadFailed
        ? "پیش‌نویس واگذار شد، اما بارگذاری تصاویر کامل نشد."
        : "پیش‌نویس ملک به کارشناس واگذار شد.",
    });
    navigate(imageUploadFailed ? "property-detail" : propertiesPage);
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handlePickImages = () => {
    fileInputRef.current?.click();
  };

  const addFilesToGallery = (files: File[]) => {
    if (!files.length) return;
    const validFiles: File[] = [];
    let invalidTypeCount = 0;
    let tooLargeCount = 0;
    let duplicateCount = 0;
    const existingKeys = new Set(gallery.map((file) => `${file.name}:${file.size}:${file.lastModified}`));

    for (const file of files) {
      const validExtension = PROPERTY_IMAGE_EXTENSION_PATTERN.test(file.name);
      const validMimeType = !file.type || PROPERTY_IMAGE_MIME_TYPES.has(file.type);
      if (!validExtension || !validMimeType) {
        invalidTypeCount += 1;
        continue;
      }
      if (file.size > MAX_PROPERTY_IMAGE_SIZE) {
        tooLargeCount += 1;
        continue;
      }
      const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
      if (existingKeys.has(fileKey)) {
        duplicateCount += 1;
        continue;
      }
      existingKeys.add(fileKey);
      validFiles.push(file);
    }

    const remainingSlots = Math.max(0, MAX_PROPERTY_IMAGES - gallery.length);
    const acceptedFiles = validFiles.slice(0, remainingSlots);
    const overflowCount = validFiles.length - acceptedFiles.length;
    if (acceptedFiles.length) setGallery((current) => [...current, ...acceptedFiles]);

    const messages = [
      invalidTypeCount ? `${invalidTypeCount.toLocaleString("fa-IR")} فایل با فرمت نامعتبر` : "",
      tooLargeCount ? `${tooLargeCount.toLocaleString("fa-IR")} تصویر بیش از ۵ مگابایت` : "",
      duplicateCount ? `${duplicateCount.toLocaleString("fa-IR")} فایل تکراری` : "",
      overflowCount ? `حداکثر ${MAX_PROPERTY_IMAGES.toLocaleString("fa-IR")} تصویر مجاز است` : "",
    ].filter(Boolean);

    if (messages.length) {
      toast({ type: "error", message: messages.join("، ") });
    }
  };

  const handleFilesSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    addFilesToGallery(Array.from(event.target.files || []));
    event.target.value = "";
  };

  const handleImageDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    addFilesToGallery(Array.from(event.dataTransfer.files || []));
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-1.5 mb-6 text-xs text-muted-foreground"><button onClick={() => navigate(propertiesPage)} className="hover:text-foreground">املاک</button><ChevronRight size={12} /><span className="text-foreground font-medium">افزودن ملک</span></div>
      <h1 className="mb-6 text-xl font-bold text-foreground">افزودن ملک</h1>
      <div className="flex items-center gap-0 mb-8">
        {labels.map((label, i) => {
          const n = i + 1; const done = n < step; const active = n === step;
          return (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div className={cx("w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all", done ? "bg-emerald-500 text-white" : active ? "bg-primary text-primary-foreground shadow-md shadow-primary/30" : "bg-secondary text-muted-foreground border border-border")}>{done ? <Check size={14} /> : n}</div>
                <span className={cx("text-xs mt-1 whitespace-nowrap font-medium", active ? "text-primary" : done ? "text-emerald-600 dark:text-emerald-300" : "text-muted-foreground")}>{label}</span>
              </div>
              {i < labels.length - 1 && <div className={cx("flex-1 h-0.5 mx-2 mb-4 rounded-full", done ? "bg-emerald-400" : "bg-border")} />}
            </div>
          );
        })}
      </div>

      <Card className="p-6">
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold mb-1">اطلاعات پایه</h2>
            <Input label="عنوان ملک" placeholder="مثال: برج مسکونی نیاوران - واحد ۱۲۰۴" value={form.title} onChange={(v) => set("title", v)} error={fieldErrors.title} required />
            <div className="grid grid-cols-2 gap-4">
              <Input label="کد داخلی" placeholder="در حال تخصیص توسط سیستم…" value={form.internalCode} onChange={() => {}} readOnly error={fieldErrors.internalCode} required />
              <SelectField
                label="نوع ملک"
                value={form.propertyTypeRef}
                onChange={(v) => set("propertyTypeRef", v)}
                options={(catalog?.propertyTypes ?? []).map((t) => ({ label: t.displayName, value: String(t.id) }))}
                placeholder="انتخاب نوع ملک"
                error={fieldErrors.propertyTypeRef}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="کاربری" value={selectedUsageLabel} onChange={() => {}} readOnly />
              <Input label="تعداد خواب" type="number" placeholder="۳ (در صورت عدم نیاز خالی بگذارید)" value={form.beds} onChange={(v) => set("beds", v)} />
            </div>
            <div className="p-3 bg-blue-50 dark:bg-blue-500/12 border border-blue-200 dark:border-blue-500/35 rounded-xl flex items-start gap-2.5">
              <Info size={14} className="text-blue-600 dark:text-blue-300 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700 dark:text-blue-300">قیمت و نوع معامله هنگام ثبت فایل مشخص می‌شوند؛ یک ملک می‌تواند همزمان چند فایل با شرایط متفاوت داشته باشد.</p>
            </div>
            {canAssignProperty && 
              <ConsultantCombobox
                label="واگذار به کارشناس"
                value={form.consultant}
                onChange={(v) => set("consultant", v)}
                error={fieldErrors.consultant}
                required
                consultants={consultants}
              />
            }
            {!canAssignProperty && <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl flex items-center gap-2 text-xs text-primary"><User size={13} />این ملک به‌طور خودکار به شما واگذار می‌شود.</div>}

            <div className="pt-2 border-t border-border">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                <UserRound size={14} />
                اطلاعات مالک
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <Input label="نام مالک" placeholder="مثال: علی" value={form.ownerFirstName} onChange={(v) => set("ownerFirstName", v)} error={fieldErrors.ownerFirstName} required />
                <Input label="نام خانوادگی مالک" placeholder="مثال: رضایی" value={form.ownerLastName} onChange={(v) => set("ownerLastName", v)} error={fieldErrors.ownerLastName} required />
              </div>
              <div className="mt-4">
                <Input label="شماره موبایل مالک" type="tel" placeholder="مثال: 09121234567" value={form.ownerPhone} onChange={(v) => set("ownerPhone", v)} error={fieldErrors.ownerPhone} required />
              </div>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold mb-1">جزئیات ملک</h2>
            <div className="grid grid-cols-2 gap-4">
              <Input label="مساحت (متر مربع)" type="number" placeholder="۱۵۰۰" value={form.area} onChange={(v) => set("area", v)} error={fieldErrors.area} required />
              <Input label="شماره طبقه" type="number" placeholder="مثال: ۲۲" value={form.floor} onChange={(v) => set("floor", v)} />
            </div>
            <Input label="سال ساخت" type="number" placeholder="مثال: ۲۰۱۹" value={form.constructionYear} onChange={(v) => set("constructionYear", v)} />
            <DynamicAttributeFields
              schema={schema}
              values={attributes}
              onChange={setAttribute}
              errors={fieldErrors}
              loading={schemaLoading}
            />
            <Input label="توضیحات" placeholder="ویژگی‌های ملک و نقاط قوت فروش را شرح دهید…" value={form.description} onChange={(v) => set("description", v)} textarea rows={5} />
          </div>
        )}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold mb-1">موقعیت و نقشه</h2>
            <LocationSelect
              tree={locationTree}
              provinceId={form.provinceId}
              cityId={form.cityId}
              districtId={form.districtId}
              onProvinceChange={(v) => setForm((p) => ({ ...p, provinceId: v, cityId: "", districtId: "" }))}
              onCityChange={(v) => setForm((p) => ({ ...p, cityId: v, districtId: "" }))}
              onDistrictChange={(v) => set("districtId", v)}
              errors={fieldErrors}
              required
            />
            <Input label="آدرس کامل" placeholder="مثال: مازندران، ساری، بلوار پاسداران، خیابان گلستان، پلاک ۱۴" value={form.fullAddress} onChange={(v) => set("fullAddress", v)} error={fieldErrors.fullAddress} required />
            <div className="pt-2 border-t border-border">
              <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5">
                <MapPin size={14} />
                موقعیت جغرافیایی
              </h3>
              <p className="text-[11px] text-muted-foreground mb-3">برای ثبت موقعیت ملک، طول و عرض جغرافیایی را وارد کنید یا از روی نقشه انتخاب کنید.</p>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Input label="عرض جغرافیایی" placeholder="مثال: 36.563421" value={form.latitude} onChange={(v) => { set("latitude", v); setCoordError(null); }} />
                </div>
                <div className="flex-1">
                  <Input label="طول جغرافیایی" placeholder="مثال: 53.060112" value={form.longitude} onChange={(v) => { set("longitude", v); setCoordError(null); }} />
                </div>
                <Btn variant="secondary" onClick={handleConfirmCoordinates}><Check size={14} />تایید</Btn>
              </div>
              {coordError && <p className="text-xs text-destructive mt-2">{coordError}</p>}
            </div>
            <PropertyMapPicker
              value={form.latitude && form.longitude ? [Number(form.latitude), Number(form.longitude)] : null}
              onChange={(p) => { setForm((s) => ({ ...s, latitude: String(p[0]), longitude: String(p[1]) })); setCoordError(null); }}
              provinceName={selectedLocationNames.provinceName}
              cityName={selectedLocationNames.cityName}
              districtName={selectedLocationNames.districtName}
              csrfToken={csrfToken}
            />
          </div>
        )}
        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold mb-1">آپلود رسانه</h2>
            <div
              role="button"
              tabIndex={0}
              aria-label="انتخاب تصویرهای ملک"
              onClick={handlePickImages}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handlePickImages();
                }
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleImageDrop}
              className="border-2 border-dashed border-border rounded-2xl p-10 text-center hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors cursor-pointer"
            >
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handleFilesSelected}/>
              <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4"><Upload size={22} className="text-muted-foreground" /></div>
              <p className="text-sm font-semibold mb-1">تصاویر را اینجا بکشید یا برای انتخاب کلیک کنید</p>
              <p className="text-xs text-muted-foreground">JPEG، PNG و WebP · حداکثر ۵ مگابایت برای هر تصویر · حداکثر ۳۰ تصویر</p>
            </div>
            {gallery.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2"><p className="text-xs font-semibold">{gallery.length.toLocaleString("fa-IR")} از {MAX_PROPERTY_IMAGES.toLocaleString("fa-IR")} تصویر در صف آپلود</p><p className="text-xs text-muted-foreground">× برای حذف</p></div>
                <div className="grid grid-cols-5 gap-2">
                  {galleryPreviews.map(({ file, url }, i) => (
                    <div key={`${file.name}-${file.size}-${file.lastModified}`} className="aspect-square rounded-lg overflow-hidden bg-secondary relative group">
                      <img src={url} alt={`پیش‌نمایش ${file.name}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setGallery((g) => g.filter((_, index) => index !== i))}
                        className="absolute top-1 right-1 w-5 h-5 bg-card/90 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {step === 4 && (
          <div className="space-y-4 border-t border-border pt-5 mt-5">
            <h2 className="text-base font-semibold mb-1">بررسی نهایی</h2>
            <div className="rounded-xl bg-secondary p-4 space-y-3">
              {[
                ["عنوان", form.title || "—"],
                ["کد داخلی", form.internalCode || "—"],
                ["نوع", selectedType?.displayName || "—"],
                ["کاربری", selectedUsageLabel],
                ["خواب", form.beds || "—"],
                ["مساحت", form.area ? `${form.area} متر مربع` : "—"],
                ["طبقه", form.floor || "—"],
                ["سال ساخت", form.constructionYear || "—"],
                ["محله", selectedDistrictLabel],
                ["آدرس کامل", form.fullAddress || "—"],
                ["نام مالک", form.ownerFirstName || "—"],
                ["نام خانوادگی مالک", form.ownerLastName || "—"],
                ["شماره موبایل مالک", form.ownerPhone || "—"],
                ...reviewAttributeRows,
                ["تصاویر", `${gallery.length} فایل`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-1.5 border-b border-border/50 last:border-0"><span className="text-sm text-muted-foreground">{k}</span><span className="text-sm font-semibold max-w-xs truncate">{v}</span></div>
              ))}
            </div>
            <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-500/12 border border-blue-200 dark:border-blue-500/35 flex items-start gap-2.5"><Info size={14} className="text-blue-600 dark:text-blue-300 flex-shrink-0 mt-0.5" /><p className="text-xs text-blue-700 dark:text-blue-300">پس از ثبت می‌توانید فایل‌ها، اسناد و وظایف مرتبط را از صفحه جزئیات ملک مدیریت کنید.</p></div>
          </div>
        )}
      </Card>

      {submitError ? (
        <div className="mt-3 text-sm text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-500/12 border border-red-200 dark:border-red-500/35 rounded-xl p-3">{submitError}</div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Btn variant="secondary" onClick={() => step > 1 ? setStep(step - 1) : navigate(propertiesPage)}><ChevronRight size={14} />{step > 1 ? "قبلی" : "انصراف"}</Btn>
        <div className="flex flex-wrap items-center gap-2">
          {canAssignProperty && <Btn variant="outline" onClick={handleSaveDraft} disabled={isSubmitting}><Check size={14} />واگذاری پیش‌نویس به کارشناس</Btn>}
          {step < total ? <Btn variant="primary" onClick={goNextStep}>ادامه <ChevronLeft size={14} /></Btn> : <Btn variant="primary" onClick={handleCreateSubmit} disabled={isSubmitting}><Check size={14} />{isSubmitting ? "در حال ذخیره…" : "ثبت ملک"}</Btn>}
        </div>
      </div>
    </div>
  );
}


export { AddPropertyWizard };
