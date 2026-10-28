import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cx } from "../../../shared/lib/utils";
import { Page, Role, Property, PropertyFile, FollowUp, ConsultantItem, BadgeV, PropertyDetailProps } from "../../../shared/lib/types";
import { fmtShort, toPersianType, toPersianDeal, toPersianPropertyStatus, toPersianTaskStatus, toPersianTaskType, toPersianPriority, toPersianChannel, propertyStatusToUI, toPersianFollowupType, isTaskOverdue, isFollowUpOverdue } from "../../../shared/lib/utils";
import { Badge } from "../../../shared/components/ui/Badge";
import { Btn } from "../../../shared/components/ui/Btn";
import { usePermissions, userRoleLabel } from "../../../shared/lib/permissions";
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
import { apiFetch, readJson, apiErrorMessage, getCsrfToken } from "../../../shared/lib/apiClient";
import { toast, formatPriceDeviation } from "../../../shared/lib/utils";
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis } from "recharts";
import { Building2, FileText, CheckSquare, BellRing, User, Users, Activity, Settings, Plus, RefreshCw, Eye, Edit2, Trash2, Archive, Clock, MapPin, Check, X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, SlidersHorizontal, ArrowUpRight, LayoutGrid, List, Download, Search, MoreVertical, Phone, Mail, Calendar, TrendingUp, Star, Shield, Lock, Key, Send, Loader2, AlertTriangle, Info, XCircle, TriangleAlert, Columns, MessageSquare, Sparkles, GripVertical, Building, History, Flame, Image, Zap, LayoutDashboard, Command, Filter, Award, BarChart3, Layers } from "lucide-react";
import { PROPERTY_STATUS_TO_BACKEND, PROPERTY_STATUSES } from "../../../shared/lib/constants";
import { useAttributeSchema } from "../../../shared/lib/useAttributeSchema";
import { statusBadge } from "../../../shared/components/ui/StatusBadge";
import { Avatar } from "../../../shared/components/ui/Avatar";
import { GalleryTab } from "../components/GalleryTab";
import { AppraisalReportTab } from "../components/AppraisalReportTab";
import { PropertyLocationMap } from "../components/PropertyLocationMap";
import { PropertyAISummary } from "../components/PropertyAISummary";
import { formatJalali, formatJalaliDT } from "../../../shared/lib/jdate";
import { PropertyTicketForm } from "../../tickets/components/PropertyTicketModal";
import { ReviewReasonModal } from "../../../shared/components/ReviewReasonModal";
import { supplyStatusBadgeMeta, formatFaInt } from "../../crm/lib/supplyDomain";

const PROPERTY_DETAIL_SECTIONS: Record<string, string> = {
  "نمای کلی": "property-overview",
  "مالکان و نمایندگان": "property-parties",
  "گالری": "property-gallery",
  "فایل‌ها": "property-propertyFiles",
  "وظایف": "property-tasks",
  "پیگیری‌ها": "property-followups",
  "گزارش": "property-report",
  "گزارش کارشناسی": "property-appraisal",
  "تاریخچه تغییرات": "property-history",
  "تیکت": "property-tickets",
};

function PropertyDetail({ navigate, role, property, currentUserId, csrfToken, onArchive, onDelete, onUpdateStatus, onApprove, onReject, openPropertyEdit, onDeleteImage, onUploadImages, onReorderImages, onUploadAppraisalReport, onDeleteAppraisalReport, openPropertyReport }: PropertyDetailProps & { openPropertyReport?: (id: string) => void; }) {
  const [tab, setTab] = useState("نمای کلی");
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const propertyTypeForSchema = (property as any)?.propertyTypeRef ?? (property as any)?.property_type_ref ?? (property as any)?.propertyTypeName ?? (property as any)?.propertyTypeDisplay ?? (property?.type ? String(property.type).toLowerCase() : null);
  const { schema: propertySchema } = useAttributeSchema("property", propertyTypeForSchema);
  const propertyAttributeNames = useMemo(() => new Set([...(propertySchema?.fields || []), ...(propertySchema?.facilities || [])].map((field) => field.name)), [propertySchema]);
  const hasPropertyAttribute = (name: string) => propertyAttributeNames.has(name);
  const rawPropertyAttributeDetails = (property as any)?.attributeDetails || (property as any)?.attribute_details || [];
  const visiblePropertyAttributeDetails = useMemo(() => Array.isArray(rawPropertyAttributeDetails) ? rawPropertyAttributeDetails.filter((attribute: any) => attribute?.name && attribute.name !== "area" && propertyAttributeNames.has(attribute.name)) : [], [rawPropertyAttributeDetails, propertyAttributeNames]);
  const visiblePropertyAttributeEntries = useMemo(() => {
    if (Array.isArray(rawPropertyAttributeDetails) && rawPropertyAttributeDetails.length) return [];
    return Object.entries((property as any)?.attributes || {}).filter(([name, value]) => name !== "area" && propertyAttributeNames.has(name) && value !== null && value !== undefined && value !== "");
  }, [property, propertyAttributeNames, rawPropertyAttributeDetails]);
  const [propStatus, setPropStatus] = useState(() => propertyStatusToUI(property?.propertyStatus));
  const [statusSaving, setStatusSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [propertyTickets, setPropertyTickets] = useState<any[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [propertyPropertyFiles, setPropertyPropertyFiles] = useState<PropertyFile[]>([]);
  const [propertyTasks, setPropertyTasks] = useState<any[]>([]);
  const [propertyFollowups, setPropertyFollowups] = useState<FollowUp[]>([]);
  const [propertyFilesLoading, setPropertyFilesLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [followupsLoading, setFollowupsLoading] = useState(false);

  const tabs = Object.keys(PROPERTY_DETAIL_SECTIONS).filter(
    (label) => label !== "تیکت" || role !== "consultant"
  );
  const selectTab = (label: string) => {
    setTab(label);
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const effectivePrice = (() => {
    const raw = (property as any)?.price;
    if (raw === null || raw === undefined || raw === "") return null;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return `${fmtShort(numeric)} تومان`;
  })();

  const buildGallery = (images?: any[] | null) =>
    images && images.length > 0 ? images : [];

  const [gallery, setGallery] = useState<any[]>(() => buildGallery(property?.images));

  const propertyId = property?.id;
  const propertyImages = property?.images;
  const propertyStatus = property?.propertyStatus;

  useEffect(() => {
    setGallery(buildGallery(propertyImages));
    setPropStatus(propertyStatusToUI(propertyStatus));
  }, [propertyId, propertyImages, propertyStatus]);

  const propertyKey = propertyId != null ? String(propertyId) : null;
  const loadedTabsRef = useRef<{ propertyFiles: string | null; tasks: string | null; followups: string | null }>({
    propertyFiles: null,
    tasks: null,
    followups: null,
  });

  useEffect(() => {
    if (!propertyKey || tab !== "فایل‌ها") return;
    if (loadedTabsRef.current.propertyFiles === propertyKey) return;
    let cancelled = false;
    setPropertyFilesLoading(true);
    (async () => {
      try {
        const pageSize = 100;
        const collected: PropertyFile[] = [];
        let page = 1;
        let total = Infinity;
        while (collected.length < total) {
          const params = new URLSearchParams({
            property: propertyKey,
            page: String(page),
            page_size: String(pageSize),
            include_sold: "true",
          });
          const res = await apiFetch(`/property-files/api/property-files/?${params.toString()}`, { method: "GET" });
          if (!res.ok) break;
          const data = await res.json();
          const items = Array.isArray(data) ? data : (data.results ?? []);
          total = Array.isArray(data) ? items.length : (data.count ?? items.length);
          collected.push(...items);
          if (items.length < pageSize) break;
          page += 1;
        }
        if (cancelled) return;
        setPropertyPropertyFiles(collected);
        loadedTabsRef.current.propertyFiles = propertyKey;
      } catch {
      } finally {
        if (!cancelled) setPropertyFilesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyKey, tab]);

  useEffect(() => {
    if (!propertyKey || tab !== "وظایف") return;
    if (loadedTabsRef.current.tasks === propertyKey) return;
    let cancelled = false;
    setTasksLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/tasks/api/tasks/?propertyId=${propertyKey}`, { method: "GET" });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          const items = Array.isArray(data) ? data : (data.results ?? []);
          setPropertyTasks(items);
          loadedTabsRef.current.tasks = propertyKey;
        }
      } catch {
      } finally {
        if (!cancelled) setTasksLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyKey, tab]);

  useEffect(() => {
    if (!propertyKey || tab !== "پیگیری‌ها") return;
    if (loadedTabsRef.current.followups === propertyKey) return;
    let cancelled = false;
    setFollowupsLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/followups/api/followups/?propertyId=${propertyKey}`, { method: "GET" });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          const items = Array.isArray(data) ? data : (data.results ?? []);
          setPropertyFollowups(items);
          loadedTabsRef.current.followups = propertyKey;
        }
      } catch {
      } finally {
        if (!cancelled) setFollowupsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyKey, tab]);

  const loadPropertyTickets = useCallback(async () => {
    if (!propertyId || role === "consultant") return;
    setTicketsLoading(true);
    try {
      const params = new URLSearchParams({
        folder: "all",
        subject_type: "PROPERTY",
        subjectId: String(propertyId),
        page_size: "20",
      });
      const res = await apiFetch(`/tickets/api/tickets/?${params.toString()}`, { method: "GET" });
      if (res.ok) {
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.results ?? []);
        setPropertyTickets(items);
      }
    } catch {
    } finally {
      setTicketsLoading(false);
    }
  }, [propertyId, role]);

  useEffect(() => {
    if (tab !== "تیکت") return;
    void loadPropertyTickets();
  }, [tab, loadPropertyTickets]);

  const handleSaveStatus = async () => {
    if (!onUpdateStatus || statusSaving || !property) return;
    setStatusSaving(true);
    try {
      const backendStatus = PROPERTY_STATUS_TO_BACKEND[propStatus] || propStatus.toUpperCase();
      const ok = await onUpdateStatus(String(property.id), backendStatus);
      if (!ok) setPropStatus(propertyStatusToUI(property.propertyStatus));
    } finally {
      setStatusSaving(false);
    }
  };

  const consultantRef = property?.consultantId ?? property?.consultant ?? null;
  const consultantRoleLabel = (() => {
    const raw = String(property?.consultantRole || "").toUpperCase();
    if (raw) return userRoleLabel(raw);
    return consultantRef ? "کارشناس" : "";
  })();
  const { can } = usePermissions();
  const canEditProperty = can("property.edit");
  const canArchiveProperty = can("property.archive");
  const canDeleteProperty = can("property.delete");
  const canReviewProperty = can("property.review");
  const canCreatePropertyFile = can("property_file.create");
  const canManageTasks = can("task.manage");
  const canManageFollowUps = can("followup.manage");

  const isStaffUser = role !== "consultant";
  const isOwnerProperty =
    currentUserId != null &&
    String(property?.consultantId ?? property?.consultant ?? "") === String(currentUserId);

  const isOwn = isStaffUser || isOwnerProperty;
  const canModifyProperty = canEditProperty && isOwn;
  const canManageProperty = isOwn;
  const canViewPrivateInfo = canModifyProperty;
  const statusOptions = [
    ...(propStatus === "Draft" ? ["Draft"] : []),
    ...(canManageProperty
      ? PROPERTY_STATUSES.filter((st) => st !== "Draft")
      : PROPERTY_STATUSES.filter((st) => st !== "Inactive" && st !== "Draft")),
  ];
    
  const canManageAppraisal =
    can("property.appraisal") && isOwn;

  const canDownloadAppraisal = canManageAppraisal;
  const showConsultantDetails = Boolean(consultantRef && isOwn);
  const openConsultantDetails = () => {
    if (!showConsultantDetails) return;
    if (role !== "consultant") navigate("consultants", consultantRef as string | number);
    else navigate("my-profile");
  };

  if (!property) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-12 text-muted-foreground bg-background">
        <Search className="w-16 h-16 mb-4 opacity-20" />
        <p className="text-sm font-medium">داده‌های ملک بارگذاری نشد.</p>
        <button
          onClick={() => navigate("properties")}
          className="mt-4 text-xs bg-primary text-primary-foreground px-4 py-2 rounded-xl"
        >
          بازگشت به لیست املاک
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
              <button onClick={() => navigate("properties")} className="hover:text-foreground">
                املاک
              </button>
              <ChevronRight size={12} />
              <span className="text-foreground font-medium">{property.internalCode || '—'}</span>
            </div>
            <h1 className="text-lg font-bold">{property.title}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {(() => {
                const reviewMeta = supplyStatusBadgeMeta("property_review", (property as Record<string, unknown>).reviewStatus as string | undefined);
                return <Badge label={`وضعیت بررسی: ${reviewMeta.label}`} variant={reviewMeta.variant} dot />;
              })()}
              {statusBadge(propStatus)}
              <Badge label={toPersianDeal(property.transactionType || 'sale')} variant="muted" />
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin size={10} />
                {(property as any).locationPath || [(property as any).provinceName, (property as any).cityName, property.district || property.neighborhood].filter(Boolean).join(" / ") || property.district || 'نامشخص'}
              </span>
              <span className="text-xs text-muted-foreground">
                {hasPropertyAttribute("floor") && property.floor != null ? ` · طبقه ${property.floor}` : ''}{hasPropertyAttribute("built_year") && property.constructionYear != null ? ` · ساخت ${property.constructionYear}` : ''}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 flex-shrink-0">
            {(property as Record<string, unknown>).propertyCaseId ? (
              <Btn variant="secondary" size="sm" onClick={() => navigate("crm-property-cases", Number((property as Record<string, unknown>).propertyCaseId))}>
                <FileText size={13} />پروندهٔ تأمین ({String((property as Record<string, unknown>).propertyCaseCode || (property as Record<string, unknown>).propertyCaseId)})
              </Btn>
            ) : null}
            {canReviewProperty && propStatus === "Draft" && (
              <>
                <Btn variant="primary" size="sm" disabled={reviewSaving || !onApprove} onClick={async () => {
                  if (!onApprove || reviewSaving) return;
                  setReviewSaving(true);
                  try { await onApprove(String(property.id)); } finally { setReviewSaving(false); }
                }}>
                  <Check size={13} />{reviewSaving ? "در حال بررسی…" : "تأیید ملک"}
                </Btn>
                <Btn variant="outline" size="sm" disabled={reviewSaving || !onReject} onClick={() => setShowRejectModal(true)}>
                  <X size={13} />بازگرداندن برای اصلاح
                </Btn>
              </>
            )}
            {canEditProperty && isOwn && (
              <Btn variant="secondary" size="sm" onClick={() => { if (openPropertyEdit) openPropertyEdit(String(property.id)); else navigate("edit-property"); }}>
                <Edit2 size={13} />ویرایش
              </Btn>
            )}
            {role !== "consultant" && (
              <Btn variant="secondary" size="sm" onClick={() => selectTab("تیکت")}>
                <MessageSquare size={13} />ثبت تیکت
              </Btn>
            )}
            {canArchiveProperty && isOwn && (
              <Btn
                variant="secondary"
                size="sm"
                disabled={propStatus === "Draft" && !canReviewProperty}
                title={propStatus === "Draft" && !canReviewProperty ? "ملک پیش‌نویس تا تأیید مدیر قابل بایگانی نیست" : undefined}
                onClick={() => setConfirmArchive(true)}
              >
                <Archive size={13} />بایگانی
              </Btn>
            )}
            {canDeleteProperty && isOwn && (
              <Btn variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={13} />حذف
              </Btn>
            )}
            {canCreatePropertyFile && canModifyProperty && (
              <Btn variant="primary" size="sm" disabled={propStatus === "Draft"} onClick={() => navigate("create-property-file", property.id)}>
                <Plus size={13} />ساخت فایل
              </Btn>
            )}
          </div>
        </div>
      </div>

      {propStatus === "Draft" && (
        <div className="border-b border-amber-200 dark:border-amber-500/35 bg-amber-50 dark:bg-amber-500/12 px-6 py-3 text-sm text-amber-900 dark:text-amber-300" role="status">
          {property.rejectionReason && !canReviewProperty ? (
            <><span className="font-semibold">برای اصلاح بازگردانده شده:</span> {property.rejectionReason} <span className="block mt-1 text-xs">پس از اصلاح، این پیش‌نویس دوباره در صف بررسی مدیر قرار می‌گیرد.</span></>
          ) : (
            <span>این ملک پیش‌نویس است و تا تأیید مدیر منتشر نخواهد شد.</span>
          )}
        </div>
      )}

      <nav aria-label="بخش‌های جزئیات ملک" className="sticky top-0 z-30 border-b border-border bg-background/95 px-3 backdrop-blur">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => selectTab(t)}
              aria-controls={PROPERTY_DETAIL_SECTIONS[t]}
              aria-current={tab === t ? "page" : undefined}
              className={cx(
                "whitespace-nowrap border-b-2 px-4 py-3 text-xs font-medium transition-colors",
                tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </nav>

      <div className="flex-1 space-y-8 bg-background p-6">
        {tab === "نمای کلی" && (
          <section id={PROPERTY_DETAIL_SECTIONS["نمای کلی"]} aria-label="نمای کلی" className="scroll-mt-28">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 max-w-6xl">
                          <div className="lg:col-span-2 space-y-5">
                <Card className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold">جزئیات ملک</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">وضعیت:</span>
                      {canModifyProperty && propStatus !== "Draft" ? (
                        <>
                          <select
                            value={propStatus}
                            onChange={(e) => setPropStatus(e.target.value)}
                            className="text-xs rounded-lg border border-border bg-input-background px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-ring"
                          >
                            {statusOptions.map((st) => <option key={st} value={st}>{toPersianPropertyStatus(st)}</option>)}
                          </select>
                          <Btn variant="primary" size="xs" onClick={handleSaveStatus} disabled={statusSaving}>
                            <Check size={11} />{statusSaving ? "در حال ذخیره..." : "ذخیره"}
                          </Btn>
                        </>
                      ) : (
                        <span className="text-xs font-medium">
                          {toPersianPropertyStatus(propStatus)}
                          {propStatus === "Draft" && !canReviewProperty ? (
                            <span className="mr-2 text-[11px] font-normal text-muted-foreground">
                              پس از تأیید مدیر قابل تغییر است.
                            </span>
                          ) : null}
                        </span>
                      )}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {([
                    ["عنوان ملک", property.title || null],
                    ["کد داخلی", property.internalCode || null],
                    ["نوع ملک", property.type ? toPersianType(property.type) : (property as any).propertyTypeDisplay || (property as any).propertyTypeName || null],
                    ["کاربری", (property as any).propertyUsageName || (property as any).propertyUsage?.displayName || (property as any).property_usage?.displayName || (property as any).usage || null],
                    ["نوع معامله", (property.transactionType || (property as any).deal_type) ? toPersianDeal(property.transactionType || (property as any).deal_type) : null],
                    ["مساحت", property.area ? `${(property.area as number).toLocaleString("fa-IR")} متر مربع` : null],
                    ["قیمت", effectivePrice],
                    ["تعداد خواب", (property.beds ?? (property as any).rooms) != null ? String(property.beds ?? (property as any).rooms) : null],
                    ["طبقه", property.floor != null ? String(property.floor) : null],
                    ["سال ساخت", (property.constructionYear || (property as any).built_year) ? String(property.constructionYear || (property as any).built_year) : null],
                    ["تاریخ ثبت", property.date ? formatJalali(property.date) : null],
                    ["آخرین بروزرسانی", (property as any).updatedAt || (property as any).updated_at ? formatJalaliDT((property as any).updatedAt || (property as any).updated_at) : null],
                    ["استان", (property as any).provinceName || (property as any).province?.displayName || (property as any).province?.display_name || (property as any).locationPath?.split(" / ")?.[0] || null],
                    ["شهر", (property as any).cityName || (property as any).city?.displayName || (property as any).city?.display_name || (property as any).locationPath?.split(" / ")?.[1] || null],
                    ["محله", (property as any).district || property.neighborhood || (typeof (property as any).district === 'object' ? ((property as any).district?.displayName || (property as any).district?.display_name || (property as any).district?.name) : null) || (property as any).locationPath?.split(" / ")?.slice(-1)?.[0] || null],
                    ["مسیر کامل موقعیت", (property as any).locationPath || ((property as any).provinceName && (property as any).cityName && (property as any).district ? `${(property as any).provinceName} / ${(property as any).cityName} / ${(property as any).district}` : null)],
                  ].filter(([, v]) => v !== null && v !== undefined && v !== '')).map(([k, v]) => (
                    <div key={k} className="p-3 bg-secondary rounded-xl">
                      <p className="text-xs text-muted-foreground mb-1">{k}</p>
                      <p className="text-sm font-semibold">{v as string}</p>
                    </div>
                  ))}
                </div>
                {property.description && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">توضیحات</p>
                    <p className="text-sm text-foreground leading-relaxed bg-secondary rounded-xl p-3">{property.description}</p>
                  </div>
                )}
              </Card>
              {(visiblePropertyAttributeDetails.length > 0 || visiblePropertyAttributeEntries.length > 0) && (
                <Card className="p-5">
                  <h3 className="text-sm font-semibold mb-3">ویژگی‌های تکمیلی</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {visiblePropertyAttributeDetails.map((attr: any) => {
                      const label = attr.displayName || attr.display_name || attr.name;
                      const val = attr.displayValue ?? attr.display_value ?? attr.value;
                      const unit = attr.unit ? ` ${attr.unit}` : '';
                      if (val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) return null;
                      const dataType = attr.dataType || attr.data_type;
                      const isoDate = typeof val === "string" && /^\d{4}-\d{2}-\d{2}/.test(val) ? formatJalali(val.slice(0, 10)) : "";
                      const asDate = dataType === "date" || isoDate;
                      const displayText = Array.isArray(val) ? val.join("، ") : (asDate && isoDate ? isoDate : `${val}${unit}`);
                      const finalText = typeof displayText === 'boolean' ? (displayText ? 'بله' : 'خیر') : displayText;
                      return (
                        <div key={attr.name || label} className="p-3 bg-secondary rounded-xl">
                          <p className="text-xs text-muted-foreground mb-1">{label}</p>
                          <p className="text-sm font-semibold">{finalText}</p>
                        </div>
                      );
                    })}
                    {visiblePropertyAttributeEntries.map(([name, value]) => {
                      const field = [...(propertySchema?.fields || []), ...(propertySchema?.facilities || [])].find((item) => item.name === name);
                      const display = value === true || value === 'true' ? 'بله' : value === false || value === 'false' ? 'خیر' : Array.isArray(value) ? value.join("، ") : String(value);
                      return (
                        <div key={name} className="p-3 bg-secondary rounded-xl">
                          <p className="text-xs text-muted-foreground mb-1">{field?.displayName || name}</p>
                          <p className="text-sm font-semibold">{display}{field?.unit ? ` ${field.unit}` : ''}</p>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}
              {(() => {
                const ownerName = [[property.ownerFirstName, property.ownerLastName].filter(Boolean).join(" "), (property as any).owner_first_name, (property as any).owner_last_name].filter(Boolean).join(" ");
                const ownerPhone = property.ownerPhone || (property as any).owner_phone;
                if (!ownerName && !ownerPhone) return null;
                if (!canViewPrivateInfo) return null;
                return (
                  <Card className="p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                        <User size={14} />
                      </div>
                      <h3 className="text-sm font-semibold">اطلاعات مالک</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-3 bg-secondary rounded-xl">
                        <p className="text-xs text-muted-foreground mb-1">نام مالک</p>
                        <p className="text-sm font-semibold">{ownerName || "—"}</p>
                      </div>
                      <div className="p-3 bg-secondary rounded-xl">
                        <p className="text-xs text-muted-foreground mb-1">شماره موبایل</p>
                        <p className="text-sm font-semibold text-right" dir="ltr">{ownerPhone || "—"}</p>
                      </div>
                    </div>
                  </Card>
                );
              })()}
              {canViewPrivateInfo && (property.fullAddress || property.address || (property as any).locationPath || (property.latitude != null && property.longitude != null)) && (
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-2">آدرس کامل</h3>
                {(property.fullAddress || property.address || (property as any).locationPath) && (
                <p className="text-sm text-foreground flex items-start gap-2">
                  <MapPin size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                  <span>
                    {(property as any).locationPath ? `${(property as any).locationPath} - ` : ''}{property.fullAddress || property.address || "—"}
                  </span>
                </p>
                )}
                {(property as any).provinceName || (property as any).cityName || (property as any).district ? (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {(property as any).provinceName && <div className="p-2.5 bg-secondary rounded-xl"><p className="text-xs text-muted-foreground">استان</p><p className="text-sm font-medium">{(property as any).provinceName}</p></div>}
                    {(property as any).cityName && <div className="p-2.5 bg-secondary rounded-xl"><p className="text-xs text-muted-foreground">شهر</p><p className="text-sm font-medium">{(property as any).cityName}</p></div>}
                    {(property as any).district && <div className="p-2.5 bg-secondary rounded-xl"><p className="text-xs text-muted-foreground">محله</p><p className="text-sm font-medium">{(property as any).district}</p></div>}
                  </div>
                ) : null}
                {property.latitude != null && property.longitude != null && (
                  <div className="mt-4">
                    <PropertyLocationMap latitude={Number(property.latitude)} longitude={Number(property.longitude)} />
                  </div>
                )}
              </Card>
              )}
            </div>

            <div className="space-y-4">
              <Card className="p-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">کارشناس</h3>
                <div className={cx("flex items-center gap-3", showConsultantDetails && "mb-3")}>
                  <Avatar 
                    initials={
                      (property.consultantName || (typeof property.consultant === "string" ? property.consultant : ""))
                        .split(" ").map((w) => w[0]).join("") 
                        || "CO"
                    } 
                    size="md" 
                  />
                  <div>
                    <p className="text-sm font-semibold">{property.consultantName || property.consultant || 'مشخص نشده'}</p>
                    {consultantRoleLabel ? (
                      <p className="text-xs text-muted-foreground">{consultantRoleLabel}</p>
                    ) : null}
                  </div>
                </div>
                {showConsultantDetails && (
                  <Btn variant="secondary" size="sm" className="w-full justify-center" onClick={openConsultantDetails}>
                    <Eye size={12} />جزئیات
                  </Btn>
                )}
              </Card>
              <PropertyAISummary property={property} />
              <Card className="p-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">شاخص‌های بازار</h3>
                <div className="space-y-3">
                  {([
                    ["روزهای حضور در بازار", property.daysOnMarket != null ? `${property.daysOnMarket.toLocaleString("fa-IR")} روز` : null],
                    ["انحراف قیمت از عرف محله", property.priceDeviationIndex != null ? formatPriceDeviation(property.priceDeviationIndex) : null],
                    ["تعداد تصاویر", (property.imagesCount ?? property.images?.length ?? 0) > 0 ? `${(property.imagesCount ?? property.images?.length ?? 0).toLocaleString("fa-IR")} تصویر` : null],
                    ["مختصات دقیق", property.geoPrecisionFlag ? "ثبت شده" : null],
                    ["امتیاز تقاضا (۳۰ روز)", (property.engagementHeatScore ?? property.views ?? 0) > 0 ? (property.engagementHeatScore ?? property.views ?? 0).toLocaleString("fa-IR") : null],
                  ].filter(([, v]) => v !== null && v !== '' && v !== undefined)).map(([k, v]) => (
                    <div key={k as string} className="flex justify-between items-start gap-2">
                      <span className="text-xs text-muted-foreground">{k}</span>
                      <span className="text-xs font-semibold text-left">{v as string}</span>
                    </div>
                  ))}
                </div>
              </Card>
              <Card className="p-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">تعامل</h3>
                <div className="space-y-3">
                  {[["فعالیت اخیر (۳۰ روز)", property.engagementHeatScore ?? property.views ?? 0]].map(([k, v]) => (
                    <div key={k as string} className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">{k}</span>
                      <span className="text-sm font-bold font-mono">{(v as number).toLocaleString("fa-IR")}</span>
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    بر اساس پیگیری‌ها و وظایف ثبت‌شده در ۳۰ روز اخیر محاسبه می‌شود.
                  </p>
                </div>
              </Card>
            </div>
          </div>
        </section>
        )}

        {tab === "گالری" && (
          <section id={PROPERTY_DETAIL_SECTIONS["گالری"]} aria-label="گالری" className="scroll-mt-28">
            <GalleryTab
              propertyId={String(property.id)}
              gallery={gallery}
              setGallery={setGallery}
              onDeleteImage={onDeleteImage}
              onUploadImages={onUploadImages}
              onReorderImages={onReorderImages}
              readOnly={!canModifyProperty}
            />
          </section>
        )}

        {tab === "گزارش کارشناسی" && (
          <section id={PROPERTY_DETAIL_SECTIONS["گزارش کارشناسی"]} aria-label="گزارش کارشناسی" className="scroll-mt-28">
            {!isOwn ? (
              <div className="max-w-5xl">
                <EmptyState
                  icon={<Lock size={28} />}
                  title="دسترسی محدود"
                  description="شما به گزارش کارشناسی این ملک دسترسی ندارید"
                />
              </div>
            ) : (
              <AppraisalReportTab
                propertyId={String(property.id)}
                report={(property as any).appraisalReport ?? null}
                canManage={canManageAppraisal}
                canDownload={canDownloadAppraisal}
                onUpload={onUploadAppraisalReport}
                onDelete={onDeleteAppraisalReport}
              />
            )}
        </section>
        )}

        {tab === "گزارش" && (
          <section id={PROPERTY_DETAIL_SECTIONS["گزارش"]} aria-label="گزارش" className="scroll-mt-28">
            <div className="max-w-4xl space-y-4">
              <Card className="p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <h3 className="text-sm font-semibold mb-1">گزارش تحلیلی ملک</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      گزارش کامل این ملک شامل ۱۵ شاخص کلیدی، نمودارها و خروجی CSV در صفحه اختصاصی گزارش‌ها در دسترس است.
                    </p>
                  </div>
                
                  {openPropertyReport && canViewPrivateInfo && (
                    <Btn variant="primary" size="sm" onClick={() => openPropertyReport(String(property.id))}>
                      <BarChart3 size={13} />مشاهده گزارش کامل
                    </Btn>
                  )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mt-4">
                {[
                  ["قیمت هر مترمربع", property.pricePerSqm != null ? `${property.pricePerSqm.toLocaleString("fa-IR")} تومان` : "—"],
                  ["تعداد تصاویر", String(property.imagesCount ?? property.images?.length ?? 0)],
                  ["روزهای حضور در بازار", property.daysOnMarket != null ? `${property.daysOnMarket.toLocaleString("fa-IR")} روز` : "—"],
                  ["تراکم فضایی", property.spatialDensityRatio != null ? String(property.spatialDensityRatio) : "—"],
                  ["انحراف قیمت از عرف محله", formatPriceDeviation(property.priceDeviationIndex)],
                  ["دقت مختصات جغرافیایی", property.geoPrecisionFlag ? "دقیق" : "نادقیق"],
                  ["امتیاز حرارت تعامل", (property.engagementHeatScore ?? property.views ?? 0).toLocaleString("fa-IR")],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 p-3 bg-secondary rounded-xl">
                    <span className="text-xs text-muted-foreground">{k}</span>
                    <span className="text-xs font-semibold">{v}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
                انحراف قیمت برای غربالگری اولیه است؛ عواملی مانند سن بنا و موقعیت دقیق نیز بر ارزش اثر می‌گذارند.
              </p>
            </Card>
            <PropertyAISummary property={property} />
          </div>
        </section>
        )}

        {tab === "فایل‌ها" && (
          <section id={PROPERTY_DETAIL_SECTIONS["فایل‌ها"]} aria-label="فایل‌ها" className="scroll-mt-28">
            {!isOwn ? (
              <div className="max-w-5xl">
                <EmptyState
                  icon={<Lock size={28} />}
                  title="دسترسی محدود"
                  description="شما به فایل‌های این ملک دسترسی ندارید"
                />
              </div>
            ) : (
            <div className="max-w-5xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">فایل‌های این ملک</h3>
                {canCreatePropertyFile && canModifyProperty && (
                  <Btn variant="primary" size="sm" disabled={propStatus === "Draft"} onClick={() => navigate("create-property-file", property.id)}>
                    <Plus size={13} />ساخت فایل جدید
                  </Btn>
                )}
            </div>
            {propertyFilesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-primary" />
              </div>
            ) : propertyPropertyFiles.length === 0 ? (
              <EmptyState
                icon={<FileText size={28} />}
                title="فایل‌ای وجود ندارد"
                description="هنوز فایل برای این ملک ثبت نشده است."
                action={canCreatePropertyFile && canModifyProperty ? <Btn variant="primary" size="sm" disabled={propStatus === "Draft"} onClick={() => navigate("create-property-file", property.id)}><Plus size={13} />ایجاد اولین فایل</Btn> : undefined}
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {propertyPropertyFiles.map((l) => {
                  const consultantName = l.assigned_to_detail?.name || property.consultantName || "نامشخص";
                  return (
                    <Card key={l.id} hover={canModifyProperty} onClick={() => { if (canModifyProperty) navigate("property-file-detail", l.id); }} className="overflow-hidden">
                      <div 
                        className="h-28 relative flex items-end p-4 bg-gradient-to-br from-slate-400 to-slate-600"
                        style={
                          l.property_detail?.image_url || (property.images && property.images.length > 0 ? property.images[0].url : undefined)
                            ? { backgroundImage: `url(${l.property_detail?.image_url || property.images?.[0]?.url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                            : undefined
                        }
                      >
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
                        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 flex-wrap">
                          {statusBadge(l.status)}
                          <Badge label={(l as any).dealTypeDisplay || toPersianDeal((l as any).dealTypeName) || "—"} variant="muted" />
                        </div>
                      </div>
                      <div className="p-4">
                        <h3 className="text-sm font-semibold mb-1 truncate">{l.title}</h3>
                        <p className="text-xs text-muted-foreground mb-2">
                          کد: {l.id} | ملک: {l.property_detail?.title || property.title || "—"}
                        </p>
                        <div className="flex flex-wrap gap-1 mb-3">
                          {(l.channels || []).map((c) => (
                            <Badge key={c} label={toPersianChannel(c)} variant="muted" />
                          ))}
                        </div>
                        <div className="space-y-1.5">
                          {(() => {
                            const salePrice = (l as any).salePrice ?? (l as any).sale_price;
                            const deposit = (l as any).deposit;
                            const monthlyRent = (l as any).monthlyRent ?? (l as any).monthly_rent;
                            const dealDisplay = (l as any).dealTypeDisplay || toPersianDeal((l as any).dealTypeName) || "";
                            const rows: { label: string; value: any }[] = [];
                            if (monthlyRent != null) {
                              rows.push({ label: "اجاره ماهانه", value: monthlyRent });
                            }
                            if (deposit != null) {
                              let label = "ودیعه";
                              if (dealDisplay.includes("رهن") && !dealDisplay.includes("اجاره")) {
                                label = "برای رهن";
                              } else if (monthlyRent != null) {
                                label = "ودیعه";
                              } else {
                                label = dealDisplay ? `برای ${dealDisplay}` : "ودیعه";
                              }
                              rows.push({ label, value: deposit });
                            }
                            if (salePrice != null) {
                              let label = "قیمت فروش";
                              if (dealDisplay.includes("فروش")) label = "قیمت فروش";
                              else if (dealDisplay.includes("پیش")) label = "پیش‌فروش";
                              else if (dealDisplay) label = `برای ${dealDisplay}`;
                              else label = "قیمت";
                              rows.push({ label, value: salePrice });
                            }
                            if (rows.length === 0) {
                              return <span className="text-xs text-muted-foreground">بدون قیمت • توافقی</span>;
                            }
                            return rows.map((r, idx) => (
                              <div key={idx} className="flex justify-between items-center text-xs">
                                <span className="text-muted-foreground">{r.label}</span>
                                <span className="font-semibold font-mono">{fmtShort(Number(r.value) || 0)}</span>
                              </div>
                            ));
                          })()}
                        </div>
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                          <ProfileAvatar
                            initials={consultantName
                              .split(" ")
                              .map((w: string) => w[0])
                              .join("") || "CO"}
                            size="xs"
                          />
                          <span className="text-xs text-muted-foreground truncate flex-1">{consultantName}</span>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
          )}
        </section>
        )}

        {tab === "وظایف" && (
          <section id={PROPERTY_DETAIL_SECTIONS["وظایف"]} aria-label="وظایف" className="scroll-mt-28">
            {!isOwn ? (
              <div className="max-w-5xl">
                <EmptyState
                  icon={<Lock size={28} />}
                  title="دسترسی محدود"
                  description="شما به وظایف این ملک دسترسی ندارید"
                />
              </div>
            ) : (
            <div className="max-w-5xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">وظایف مرتبط با این ملک</h3>
                {canManageTasks && canModifyProperty && (
                  <Btn variant="primary" size="sm" onClick={() => navigate("tasks-kanban")}>
                    <Plus size={13} />ایجاد وظیفه
                  </Btn>
                )}
            </div>
            {tasksLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-primary" />
              </div>
            ) : propertyTasks.length === 0 ? (
              <EmptyState
                icon={<CheckSquare size={28} />}
                title="وظیفه‌ای وجود ندارد"
                description="هنوز وظیفه‌ای برای این ملک ثبت نشده است."
                action={canManageTasks && canModifyProperty ? <Btn variant="primary" size="sm" onClick={() => navigate("tasks-kanban")}><Plus size={13} />ایجاد اولین وظیفه</Btn> : undefined}
              />
            ) : (
              <div className="space-y-3">
                {propertyTasks.map((t) => (
                  <Card key={t.id} className="p-4 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">{t.title}</p>
                      {t.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{t.description}</p>}
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        {statusBadge(t.status)}
                        {statusBadge(t.priority)}
                        <Badge label={t.taskType || toPersianTaskType(t.task_type)} variant="muted" />
                        {isTaskOverdue(t) && <Badge label="از تاریخ گذشته" variant="danger" />}
                        <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock size={10} />سررسید {t.due || t.due_date || "—"}</span>
                        {t.assigned_to_detail?.name && (
                          <div className="flex items-center gap-1.5">
                            <ProfileAvatar imageUrl={t.assigned_to_detail.profile_image} initials={(t.assigned_to_detail.name || "?").split(" ").map((w: string) => w[0]).join("").slice(0, 2)} size="xs" />
                            <span className="text-xs text-muted-foreground">{t.assigned_to_detail.name}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
          )}
        </section>
        )}

        {tab === "پیگیری‌ها" && (
          <section id={PROPERTY_DETAIL_SECTIONS["پیگیری‌ها"]} aria-label="پیگیری‌ها" className="scroll-mt-28">
            {!isOwn ? (
              <div className="max-w-5xl">
                <EmptyState
                  icon={<Lock size={28} />}
                  title="دسترسی محدود"
                  description="شما به پیگیری‌های این ملک دسترسی ندارید"
                />
              </div>
            ) : (
            <div className="max-w-5xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">پیگیری‌های این ملک</h3>
                {canManageFollowUps && canModifyProperty && (
                  <Btn variant="primary" size="sm" onClick={() => navigate("create-followup")}>
                    <Plus size={13} />ثبت پیگیری
                  </Btn>
                )}
            </div>
            {followupsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-primary" />
              </div>
            ) : propertyFollowups.length === 0 ? (
              <EmptyState
                icon={<BellRing size={28} />}
                title="پیگیری‌ای وجود ندارد"
                description="هنوز پیگیری برای این ملک ثبت نشده است."
                action={canManageFollowUps && canModifyProperty ? <Btn variant="primary" size="sm" onClick={() => navigate("create-followup")}><Plus size={13} />ثبت اولین پیگیری</Btn> : undefined}
              />
            ) : (
              <div className="relative">
                <div className="absolute right-5 top-0 bottom-0 w-px bg-border" />
                <div className="space-y-4">
                  {propertyFollowups.map((fu) => (
                    <div key={fu.id} className="flex gap-4">
                      <div className="relative z-10 flex-shrink-0">
                        <div className={cx("w-10 h-10 rounded-xl flex items-center justify-center text-white", fu.type === "Call" ? "bg-blue-500" : fu.type === "Meeting" ? "bg-purple-500" : fu.type === "Email" ? "bg-slate-600" : "bg-emerald-500")}>
                          {fu.type === "Call" ? <Phone size={14} /> : fu.type === "Meeting" ? <Users size={14} /> : fu.type === "Email" ? <Mail size={14} /> : <MapPin size={14} />}
                        </div>
                      </div>
                      <Card className="flex-1 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">{statusBadge(fu.type)}{statusBadge(fu.status)}{isFollowUpOverdue(fu) && <Badge label="از تاریخ گذشته" variant="danger" />}</div>
                            <h3 className="text-sm font-semibold">{fu.title}</h3>
                            <p className="text-xs text-muted-foreground mt-1">مخاطب: <strong>{fu.contact}</strong> · {fu.consultant} · {fu.date}</p>
                            {fu.outcome && <div className="mt-2 px-3 py-2 bg-secondary rounded-xl text-xs"><span className="font-medium">نتیجه:</span> {fu.outcome}</div>}
                          </div>
                        </div>
                      </Card>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}
        </section>
        )}

        {role !== "consultant" && tab === "تیکت" && (
          <section id={PROPERTY_DETAIL_SECTIONS["تیکت"]} aria-label="تیکت" className="scroll-mt-28">
            <div className="max-w-4xl space-y-4">
              <Card className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <MessageSquare size={14} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">ثبت تیکت برای این ملک</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      درخواست شما مستقیم برای کارشناس مسئول ملک ارسال می‌شود؛ نتیجه در بخش تیکت‌ها قابل پیگیری است.
                    </p>
                  </div>
                </div>
                <PropertyTicketForm
                  propertyId={property.id}
                  csrfToken={csrfToken}
                  onCreated={() => {
                    void loadPropertyTickets();
                  }}
                />
              </Card>
              <Card className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold">تیکت‌های این ملک</h3>
                  <Btn variant="secondary" size="sm" onClick={() => navigate("tickets-all")}>
                    <ArrowUpRight size={13} />همه تیکت‌ها
                  </Btn>
                </div>
                {ticketsLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 size={22} className="animate-spin text-primary" />
                  </div>
                ) : propertyTickets.length === 0 ? (
                  <EmptyState
                    icon={<MessageSquare size={28} />}
                    title="تیکتی ثبت نشده است"
                    description="برای این ملک تا حالا تیکتی ثبت نشده است."
                  />
                ) : (
                  <div className="space-y-3">
                    {propertyTickets.map((ticket) => (
                      <div key={ticket.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3">
                        <span className="font-mono text-[11px] text-muted-foreground">{ticket.ticketNumber || `#${ticket.id}`}</span>
                        <span className="text-sm font-medium truncate flex-1 min-w-32">{ticket.title}</span>
                        <Badge label={ticket.statusLabel || ticket.status} variant="muted" />
                        <Badge label={ticket.priorityLabel || ticket.priority} variant="muted" />
                        <span className="text-[11px] text-muted-foreground">
                          {formatJalaliDT(ticket.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </section>
        )}

        {tab === "مالکان و نمایندگان" && (
          <section id={PROPERTY_DETAIL_SECTIONS["مالکان و نمایندگان"]} aria-label="مالکان و نمایندگان" className="scroll-mt-28 max-w-4xl">
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">مالکان و نمایندگان ثبت‌شده (PropertyParty)</h3>
                {(property as Record<string, unknown>).propertyCaseId ? (
                  <Btn variant="secondary" size="sm" onClick={() => navigate("crm-property-register", Number((property as Record<string, unknown>).propertyCaseId))}>
                    ویرایش در کارشناسی پرونده
                  </Btn>
                ) : null}
              </div>
              {(() => {
                const rawParties = ((property as Record<string, unknown>).parties as Array<Record<string, unknown>> | undefined) || [];
                if (!rawParties.length) {
                  return (
                    <EmptyState
                      icon={<Users size={26} />}
                      title="شخص مرتبطی ثبت نشده است"
                      description="اطلاعات مالکان و نمایندگان از طریق مرحلهٔ کارشناسی پرونده ثبت می‌شود."
                    />
                  );
                }
                return (
                  <div className="space-y-2.5">
                    {rawParties.map((party, idx) => (
                      <div key={String(party.id || idx)} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3.5 text-xs">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <strong className="text-sm font-semibold text-foreground">{String(party.fullName || party.full_name || "نامشخص")}</strong>
                            <Badge
                              label={party.role === "OWNER_REPRESENTATIVE" || party.role === "REPRESENTATIVE" ? "نماینده مالک" : "مالک"}
                              variant={party.isPrimary ? "success" : "info"}
                            />
                            {party.isPrimary ? <Badge label="طرف اصلی" variant="teal" /> : null}
                          </div>
                          <div className="text-muted-foreground">
                            شماره تماس: <span className="font-mono">{String(party.phone || "نامشخص")}</span>
                          </div>
                        </div>
                        <div className="rounded-lg bg-secondary px-3 py-1.5 font-semibold text-foreground">
                          سهم مالکیت: {party.sharePercent != null ? `${formatFaInt(String(party.sharePercent))}٪` : "نامشخص"}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </Card>
          </section>
        )}

        {tab === "تاریخچه تغییرات" && (
          <section id={PROPERTY_DETAIL_SECTIONS["تاریخچه تغییرات"]} aria-label="تاریخچه تغییرات" className="scroll-mt-28 max-w-4xl">
            <Card className="p-5 space-y-4">
              <h3 className="text-sm font-semibold">تاریخچهٔ تغییرات کارشناسی و بررسی ملک</h3>
              {(() => {
                const historyRows = ((property as Record<string, unknown>).changeHistory as Array<Record<string, unknown>> | undefined) || [];
                const appraisalObj = (property as Record<string, unknown>).structuredAppraisal as Record<string, unknown> | undefined;
                const archivedReports = (appraisalObj?.archived_reports as Array<Record<string, unknown>> | undefined) || [];
                if (!historyRows.length && !archivedReports.length) {
                  return (
                    <EmptyState
                      icon={<History size={26} />}
                      title="تاریخچه‌ای ثبت نشده است"
                      description="سوابق بررسی مدیر و گزارش‌های بایگانی‌شدهٔ کارشناسی در این بخش نمایش داده می‌شوند."
                    />
                  );
                }
                return (
                  <div className="space-y-3">
                    {historyRows.map((entry, idx) => (
                      <div key={String(entry.id || idx)} className="rounded-xl border border-border p-3.5 text-xs space-y-1">
                        <div className="flex flex-wrap justify-between gap-2 font-semibold text-foreground">
                          <span>{String(entry.title || entry.decisionDisplay || entry.decision || "رویداد بررسی")}</span>
                          <span className="text-muted-foreground">
                            {entry.at ? formatJalaliDT(String(entry.at)) : "نامشخص"}
                          </span>
                        </div>
                        <div className="text-muted-foreground">
                          نسخه: {formatFaInt(entry.version as number | string | null)} · ثبت‌کننده: {String(entry.actor || entry.reviewedBy || entry.submittedBy || "سامانه")}
                          {entry.reason ? ` · توضیح: ${String(entry.reason)}` : ""}
                        </div>
                      </div>
                    ))}
                    {archivedReports.map((rep, idx) => (
                      <div key={`arch-${idx}`} className="rounded-xl border border-amber-500/35 bg-amber-500/5 p-3.5 text-xs space-y-1">
                        <div className="flex flex-wrap justify-between gap-2 font-semibold text-foreground">
                          <span>گزارش کارشناسی بایگانی‌شده پس از بازگشایی</span>
                          <span className="text-muted-foreground">
                            {rep.archived_at ? formatJalaliDT(String(rep.archived_at)) : "نامشخص"}
                          </span>
                        </div>
                        {rep.reopen_reason ? <p className="text-muted-foreground">علت بازگشایی: {String(rep.reopen_reason)}</p> : null}
                        {rep.report_text ? <p className="whitespace-pre-wrap text-foreground">{String(rep.report_text)}</p> : null}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </Card>
          </section>
        )}
      </div>

      {showRejectModal && onReject && (
        <ReviewReasonModal
          title="بازگرداندن ملک برای اصلاح"
          description="کارشناس با این توضیح می‌تواند اطلاعات را اصلاح کند. ملک تا تأیید دوباره منتشر نمی‌شود."
          submitLabel="بازگرداندن برای اصلاح"
          busy={reviewSaving}
          onCancel={() => setShowRejectModal(false)}
          onConfirm={async (reason) => {
            setReviewSaving(true);
            try {
              if (await onReject(String(property.id), reason)) setShowRejectModal(false);
            } finally {
              setReviewSaving(false);
            }
          }}
        />
      )}
      <ConfirmModal 
        open={confirmArchive && !(propStatus === "Draft" && !canReviewProperty)}
        title="بایگانی ملک؟" 
        message="این ملک بایگانی شده و از فایل‌های فعال مخفی می‌شود. بعداً قابل بازیابی است." 
        onConfirm={() => { 
          if (property) onArchive(String(property.id));
          setConfirmArchive(false); 
        }} 
        onCancel={() => setConfirmArchive(false)} 
      />
      <ConfirmModal 
        open={confirmDelete} 
        danger 
        title="حذف ملک؟" 
        message="این ملک و تمام داده‌های مرتبط با آن برای همیشه حذف خواهند شد. این عملیات غیرقابل بازگشت است." 
        onConfirm={() => { 
          if (property) onDelete(String(property.id));
          setConfirmDelete(false); 
        }} 
        onCancel={() => setConfirmDelete(false)} 
      />
    </div>
  );
}


export { PropertyDetail };
