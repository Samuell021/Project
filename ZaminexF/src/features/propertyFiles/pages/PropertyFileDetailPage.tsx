import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cx } from "../../../shared/lib/utils";
import { Page, Role, Property, PropertyFile, FollowUp, ConsultantItem, BadgeV } from "../../../shared/lib/types";
import { fmtShort, toPersianType, toPersianDeal, toPersianPropertyStatus, toPersianTaskStatus, toPersianTaskType, toPersianPriority, toPersianChannel, propertyStatusToUI, toPersianFollowupType, toPersianPropertyFileStatus } from "../../../shared/lib/utils";
import { Badge } from "../../../shared/components/ui/Badge";
import { Btn } from "../../../shared/components/ui/Btn";
import { usePermissions } from "../../../shared/lib/permissions";
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
import { MultiPropertyCombobox } from "../../../shared/components/ui/MultiPropertyCombobox";
import { MultiConsultantCombobox } from "../../../shared/components/ui/MultiConsultantCombobox";
import { apiFetch, readJson, apiErrorMessage, getCsrfToken } from "../../../shared/lib/apiClient";
import { toast, delegationLabel } from "../../../shared/lib/utils";
import { Building2, LayoutDashboard, FileText, CheckSquare, Users, BarChart3, Settings, Bell, Search, LogOut, Plus, ChevronLeft, ChevronDown, ChevronRight, Clock, CheckCircle2, AlertCircle, MoreHorizontal, MapPin, Eye, Edit2, Trash2, Archive, Phone, Mail, Calendar, TrendingUp, Activity, Command, Star, List, LayoutGrid, Download, Shield, User, Lock, Key, RefreshCw, Circle, Zap, Target, Award, Upload, Check, AlertTriangle, Info, XCircle, Loader2, CircleCheck, TriangleAlert, Columns, Send, BellRing, X, ChevronUp, SlidersHorizontal, ArrowUpRight, Layers, MessageSquare, Sparkles, GripVertical, MoreVertical, Building, History, Flame, Image, Filter } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, ReferenceLine, ScatterChart, Scatter, ZAxis, RadialBarChart, RadialBar } from "recharts";
import { StatusChangeModal } from "../components/StatusChangeModal";

function ListingLifecycleCard({ propertyFile }: { propertyFile: PropertyFile }) {
  const [versions, setVersions] = useState<{ version: number; snapshot: Record<string, unknown>; created_at: string }[] | null>(null);
  const [priceHistory, setPriceHistory] = useState<Array<{ id: number; sale_price: string | null; deposit: string | null; monthly_rent: string | null; changed_by_name?: string; changed_at?: string | null }>>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [response, histResp] = await Promise.all([
          apiFetch(`/listings/api/listings/${propertyFile.id}/versions/`, { method: "GET" }, getCsrfToken()),
          apiFetch(`/crm/api/listings/${propertyFile.id}/price-history/`, { method: "GET" }, getCsrfToken()),
        ]);
        const body = await readJson(response);
        if (!response.ok) throw new Error(apiErrorMessage(body, "دریافت نسخه‌ها ناموفق بود"));
        if (active) setVersions(Array.isArray(body) ? body : []);
        if (histResp.ok) {
          const histBody = await readJson(histResp);
          if (active && Array.isArray(histBody)) setPriceHistory(histBody);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "دریافت نسخه‌ها ناموفق بود");
      }
    })();
    return () => { active = false; };
  }, [propertyFile.id]);
  const fields = propertyFile.termsSchema?.fields || [];
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold mb-3">شرایط معامله، نسخه‌ها و تاریخچهٔ قیمت</h3>
      <div className="grid grid-cols-2 gap-3 text-sm">
        {fields.map((field) => (
          <div key={field.key} className="flex justify-between gap-3 rounded-xl bg-secondary p-3">
            <span className="text-xs text-muted-foreground">{field.label}</span>
            <span className="text-xs font-semibold">{String(propertyFile.terms?.[field.key] ?? "نامشخص")}</span>
          </div>
        ))}
        {!fields.length ? <p className="col-span-2 text-xs text-muted-foreground">تعریف شرایط برای این نوع معامله ثبت نشده است.</p> : null}
      </div>
      {priceHistory.length > 0 ? (
        <div className="mt-4 border-t pt-3 space-y-2">
          <h4 className="text-xs font-bold text-foreground">تاریخچهٔ تغییرات قیمت</h4>
          {priceHistory.map((ph) => (
            <div key={ph.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary/60 px-3 py-2 text-xs">
              <span className="font-semibold text-foreground">
                {ph.sale_price ? `ثمن: ${Number(ph.sale_price).toLocaleString("fa-IR")} تومان ` : ""}
                {ph.deposit ? `ودیعه: ${Number(ph.deposit).toLocaleString("fa-IR")} تومان ` : ""}
                {ph.monthly_rent ? `اجاره: ${Number(ph.monthly_rent).toLocaleString("fa-IR")} تومان` : ""}
              </span>
              <span className="text-muted-foreground">
                {ph.changed_by_name || "سامانه"} · {ph.changed_at ? new Date(ph.changed_at).toLocaleString("fa-IR") : "نامشخص"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-4 border-t pt-3">
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {versions === null && !error ? <p className="text-xs text-muted-foreground">در حال دریافت تاریخچه…</p> : null}
        {(versions || []).map((item) => (
          <div key={item.version} className="mb-2 flex items-center justify-between rounded-xl border p-3 text-xs">
            <span className="font-semibold">نسخه {item.version.toLocaleString("fa-IR")}</span>
            <span className="text-muted-foreground">{String(item.snapshot?.status ?? "")} · {new Date(item.created_at).toLocaleString("fa-IR")}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PropertyFileDetailPage({ 
  navigate, 
  role,
  propertyFile,
  onAction
}: { 
  navigate: (p: any, id?: string | number) => void; 
  role: Role;
  propertyFile?: PropertyFile;
  onAction: (action: any, id: string | number, status?: string, reason?: string) => void;
}) {
  if (!propertyFile) {
    return <div className="p-6 text-center text-sm text-muted-foreground">در حال بارگذاری جزئیات…</div>;
  }

  const { can } = usePermissions();
  const canEditPropertyFile = can("property_file.edit");
  const canReviewPropertyFile = can("property_file.review");
  const canChangeStatus = can("property_file.status");
  const [statusModal, setStatusModal] = useState(false);
  const consultantName = propertyFile.assigned_to_detail?.name || "واگذار نشده";
  const propertyDetail = propertyFile.property_detail;

  const statusBadge = (st: string) => {
    const map: Record<string, string> = {
      "ACTIVE": "bg-emerald-100 dark:bg-emerald-500/18 text-emerald-800 dark:text-emerald-300",
      "DRAFT": "bg-surface-muted text-foreground",
      "PAUSED": "bg-amber-100 dark:bg-amber-500/18 text-amber-800 dark:text-amber-300",
      "SOLD": "bg-purple-100 dark:bg-purple-500/18 text-purple-800 dark:text-purple-300",
      "EXPIRED": "bg-red-100 dark:bg-red-500/18 text-red-800 dark:text-red-300",
      "ARCHIVED": "bg-blue-100 dark:bg-blue-500/18 text-blue-800 dark:text-blue-300",
    };
    return <span className={`px-2 py-0.5 rounded text-xs font-semibold ${map[st] || "bg-surface-muted"}`}>{toPersianPropertyFileStatus(st)}</span>;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
              <button onClick={() => navigate("property-files")} className="hover:text-foreground">فایل‌ها</button>
              <ChevronRight size={12} /><span className="text-foreground font-medium">{propertyFile.id}</span>
            </div>
            <h1 className="text-lg font-bold">{propertyFile.title}</h1>
            <div className="flex items-center gap-2 mt-1">
              {statusBadge(propertyFile.status)}
              <span className="text-xs text-muted-foreground">کانال: {toPersianChannel(propertyFile.publishChannel)}</span>
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {canEditPropertyFile && <Btn variant="secondary" size="sm" onClick={() => navigate("edit-property-file", propertyFile.id)}><Edit2 size={13} />ویرایش</Btn>}
            {canChangeStatus && <Btn variant="outline" size="sm" onClick={() => setStatusModal(true)} disabled={propertyFile.status === "DRAFT" && !canReviewPropertyFile}><RefreshCw size={13} />تغییر وضعیت</Btn>}
            {canEditPropertyFile && <Btn variant="danger" size="sm" onClick={() => onAction("delete", propertyFile.id)}><Trash2 size={13} />حذف</Btn>}
          </div>
        </div>
      </div>

      {propertyFile.status === "DRAFT" && propertyFile.rejectionReason && !canReviewPropertyFile && (
        <div className="border-b border-amber-200 dark:border-amber-500/35 bg-amber-50 dark:bg-amber-500/12 px-6 py-3 text-sm text-amber-900 dark:text-amber-300" role="status">
          <span className="font-semibold">برای اصلاح بازگردانده شده:</span> {propertyFile.rejectionReason}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-6 bg-background">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            {propertyDetail && (
              <Card className="p-5 overflow-hidden">
                <h3 className="text-sm font-semibold mb-3">ملک مرتبط</h3>
                <div className="flex gap-4 items-start">
                  {propertyDetail.image_url ? (
                    <div className="w-28 h-20 flex-shrink-0 rounded-xl overflow-hidden bg-secondary">
                      <img src={propertyDetail.image_url} alt={propertyDetail.title || 'ملک'} className="w-full h-full object-cover" />
                    </div>
                  ) : null}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-base font-bold truncate">{propertyDetail.title || 'عنوان نامشخص'}</h4>
                    <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground">
                      {propertyDetail.internal_code && <span>کد: {propertyDetail.internal_code}</span>}
                      {propertyDetail.district && <span>· {propertyDetail.district}</span>}
                      {propertyDetail.area != null && <span>· مساحت: {(propertyDetail.area as number).toLocaleString("fa-IR")} متر</span>}
                      {propertyDetail.floor != null && <span>· طبقه: {propertyDetail.floor}</span>}
                    </div>
                    <Btn variant="secondary" size="xs" className="mt-3" onClick={() => navigate("property-detail", propertyDetail.id)}>
                      مشاهده جزئیات ملک
                    </Btn>
                  </div>
                </div>
              </Card>
            )}

            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-3">اطلاعات پایه فایل</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  ["شناسه فایل", propertyFile.id != null ? String(propertyFile.id) : null],
                  ["نوع معامله", (propertyFile.deal_type || propertyFile.transactionType) ? toPersianDeal(propertyFile.deal_type || propertyFile.transactionType) : null],
                  ["اولویت", propertyFile.priority != null ? toPersianPriority(String(propertyFile.priority)) : null],
                  ["فایل ویژه", propertyFile.is_featured === true ? "بله" : null],
                  ["وضعیت", propertyFile.status ? toPersianPropertyFileStatus(propertyFile.status) : null],
                  ["کانال انتشار", propertyFile.publishChannel ? toPersianChannel(propertyFile.publishChannel) : null],
                  ["کارشناس", consultantName || null],
                ].filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
                  <div key={k} className="p-3 bg-secondary rounded-xl"><p className="text-xs text-muted-foreground mb-1">{k}</p><p className="text-sm font-semibold">{v}</p></div>
                ))}
              </div>
            </Card>

            {propertyFile.description && (
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-3">توضیحات</h3>
                <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">{propertyFile.description}</p>
              </Card>
            )}

            {(() => {
              const salePrice = (propertyFile as any).salePrice ?? (propertyFile as any).sale_price;
              const deposit = (propertyFile as any).deposit;
              const monthlyRent = (propertyFile as any).monthlyRent ?? (propertyFile as any).monthly_rent;
              const dealDisplay = (propertyFile as any).dealTypeDisplay || toPersianDeal((propertyFile as any).dealTypeName || (propertyFile as any).deal_type) || "—";
              const hasPrice = salePrice != null || deposit != null || monthlyRent != null;
              if (!hasPrice && !dealDisplay) return null;
              
              const priceRows: { label: string; value: string; hint?: string }[] = [];
              
              if (monthlyRent != null && monthlyRent !== '') {
                priceRows.push({ 
                  label: "اجاره ماهانه", 
                  value: fmtShort(Number(monthlyRent) || 0),
                  hint: "برای اجاره"
                });
              }
              if (deposit != null && deposit !== '') {
                const isRahnOnly = dealDisplay.includes("رهن") && !dealDisplay.includes("اجاره");
                const label = isRahnOnly ? "قیمت رهن" : (monthlyRent != null ? "ودیعه" : (dealDisplay.includes("رهن") ? "رهن" : "ودیعه"));
                const hint = isRahnOnly ? "برای رهن کامل" : (monthlyRent != null ? "ودیعه اولیه" : `برای ${dealDisplay}`);
                priceRows.push({ label, value: fmtShort(Number(deposit) || 0), hint });
              }
              if (salePrice != null && salePrice !== '') {
                let label = "قیمت فروش";
                let hint = `برای ${dealDisplay}`;
                if (dealDisplay.includes("فروش")) {
                  label = "قیمت فروش";
                  hint = "برای خرید";
                } else if (dealDisplay.includes("پیش")) {
                  label = "قیمت پیش‌فروش";
                  hint = "پیش‌فروش";
                } else if (dealDisplay) {
                  label = `قیمت ${dealDisplay}`;
                  hint = `برای ${dealDisplay}`;
                }
                priceRows.push({ label, value: fmtShort(Number(salePrice) || 0), hint });
              }

              return (
                <Card className="p-5">
                  <h3 className="text-sm font-semibold mb-3">اطلاعات قیمت و معامله</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3 bg-secondary rounded-xl">
                      <p className="text-xs text-muted-foreground mb-1">نوع معامله</p>
                      <p className="text-sm font-semibold">{dealDisplay}</p>
                    </div>
                    {priceRows.map((row, idx) => (
                      <div key={idx} className="p-3 bg-secondary rounded-xl">
                        <p className="text-xs text-muted-foreground mb-1">{row.label}</p>
                        <p className="text-sm font-semibold">{row.value}</p>
                        {row.hint && <p className="text-xs text-muted-foreground mt-1">{row.hint}</p>}
                      </div>
                    ))}
                    {priceRows.length === 0 && (
                      <div className="p-3 bg-secondary rounded-xl">
                        <p className="text-xs text-muted-foreground mb-1">مبلغ</p>
                        <p className="text-sm font-semibold">توافقی</p>
                      </div>
                    )}
                    {(propertyFile as any).priceDetails && typeof (propertyFile as any).priceDetails === 'object' && Object.keys((propertyFile as any).priceDetails || {}).length > 0 && (
                      <div className="p-3 bg-secondary rounded-xl col-span-1 sm:col-span-2">
                        <p className="text-xs text-muted-foreground mb-1">جزئیات پرداخت</p>
                        <p className="text-sm font-mono">{JSON.stringify((propertyFile as any).priceDetails)}</p>
                      </div>
                    )}
                    {(propertyFile as any).price_details && typeof (propertyFile as any).price_details === 'object' && Object.keys((propertyFile as any).price_details || {}).length > 0 && !(propertyFile as any).priceDetails && (
                      <div className="p-3 bg-secondary rounded-xl col-span-1 sm:col-span-2">
                        <p className="text-xs text-muted-foreground mb-1">جزئیات پرداخت</p>
                        <p className="text-sm font-mono">{JSON.stringify((propertyFile as any).price_details)}</p>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })()}

            {(propertyFile.attributes && Object.values(propertyFile.attributes).some((v) => v !== null && v !== undefined && v !== '')) && (
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-3">ویژگی‌های تکمیلی فایل</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Object.entries(propertyFile.attributes || {})
                    .map(([k, v]) => {
                      if (v === null || v === undefined || v === '') return null;
                      const display = v === true || v === 'true' ? 'بله' : v === false || v === 'false' ? 'خیر' : String(v);
                      return [k, display];
                    })
                    .filter((item) => item !== null)
                    .map(([k, v]) => (
                      <div key={k} className="p-3 bg-secondary rounded-xl"><p className="text-xs text-muted-foreground mb-1">{k}</p><p className="text-sm font-semibold">{v}</p></div>
                    ))}
                </div>
              </Card>
            )}

            <ListingLifecycleCard propertyFile={propertyFile} />

            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-3">جزئیات انتشار</h3>
              <div className="grid grid-cols-2 gap-4">
                {[
                  ["تاریخ شروع", propertyFile.start_date ? new Date(propertyFile.start_date).toLocaleDateString("fa-IR", { year: 'numeric', month: 'long', day: 'numeric' }) : null],
                  ["تاریخ پایان", propertyFile.end_date ? new Date(propertyFile.end_date).toLocaleDateString("fa-IR", { year: 'numeric', month: 'long', day: 'numeric' }) : null],
                  ["کانال", propertyFile.publishChannel ? toPersianChannel(propertyFile.publishChannel) : null],
                  ["کارشناس", consultantName || null],
                  ["تاریخ ایجاد فایل", propertyFile.created_at ? new Date(propertyFile.created_at).toLocaleDateString("fa-IR", { year: 'numeric', month: 'long', day: 'numeric' }) : null],
                ].filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
                  <div key={k} className="p-3 bg-secondary rounded-xl"><p className="text-xs text-muted-foreground mb-1">{k}</p><p className="text-sm font-semibold">{v}</p></div>
                ))}
              </div>
            </Card>

            {((propertyFile.effectiveExposureDays != null && propertyFile.effectiveExposureDays > 0) || (propertyFile.delegationIndicator != null && propertyFile.delegationIndicator !== '') || (propertyFile.generatedHighProbLeads != null && propertyFile.generatedHighProbLeads > 0) || (propertyFile.contentRichnessScore != null && propertyFile.contentRichnessScore > 0) || propertyFile.isBurnedPropertyFile === true) && (
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-3">گزارش تحلیلی فایل</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  {[
                    ["امتیاز کیفیت", propertyFile.score != null ? `${propertyFile.score}/۱۰۰` : null],
                    ["امتیاز تقاضا (حرارت تعامل)", propertyFile.views != null ? (propertyFile.views ?? 0).toLocaleString("fa-IR") : null],
                    ["روزهای نمایش مؤثر", propertyFile.effectiveExposureDays != null ? `${propertyFile.effectiveExposureDays.toLocaleString("fa-IR")} روز` : null],
                    ["شاخص تفویض", propertyFile.delegationIndicator ? delegationLabel(propertyFile.delegationIndicator) : null],
                    ["سرنخ‌های باکیفیت (≥۷۰٪)", (propertyFile.generatedHighProbLeads ?? 0) > 0 ? (propertyFile.generatedHighProbLeads ?? 0).toLocaleString("fa-IR") : null],
                    ["غنای محتوا", (propertyFile.contentRichnessScore ?? 0) > 0 ? `${propertyFile.contentRichnessScore}/۵` : null],
                    ["وضعیت اتلاف", propertyFile.isBurnedPropertyFile === true ? "بله" : null],
                  ].filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 p-3 bg-secondary rounded-xl">
                      <span className="text-xs text-muted-foreground">{k}</span>
                      <span className="text-xs font-semibold">{v}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <Card className="p-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">عملیات سریع</h3>
              <div className="space-y-2">
                {canChangeStatus && propertyFile.status === "DRAFT" && <Btn variant="primary" size="sm" fullWidth onClick={() => onAction("approve", propertyFile.id)}><Check size={13} />انتشار فایل</Btn>}
                {propertyFile.status === "ARCHIVED"
                  ? <Btn variant="secondary" size="sm" fullWidth onClick={() => onAction("unarchive", propertyFile.id)}><CheckCircle2 size={13} />فعال کردن فایل</Btn>
                  : <Btn variant="secondary" size="sm" fullWidth disabled={propertyFile.status === "DRAFT"} onClick={() => onAction("archive", propertyFile.id)}><Archive size={13} />بایگانی فایل</Btn>}
              </div>
            </Card>
          </div>
        </div>
      </div>

      {statusModal && (
        <StatusChangeModal
          propertyFile={propertyFile}
          canReject={false}
          onClose={() => setStatusModal(false)}
          onApply={(newSt, reason) => {
            if (newSt === "DRAFT" && canReviewPropertyFile) onAction("reject", propertyFile.id, undefined, reason);
            else if (newSt === "ACTIVE" && propertyFile.status === "DRAFT" && canReviewPropertyFile) onAction("approve", propertyFile.id);
            else if (newSt === "PAUSED" && propertyFile.status === "ACTIVE") onAction("pause", propertyFile.id);
            else if (newSt === "ACTIVE" && propertyFile.status === "PAUSED") onAction("set_status", propertyFile.id, newSt);
            else if (newSt === "ACTIVE" && propertyFile.status === "ARCHIVED") onAction("unarchive", propertyFile.id);
            else if (newSt === "ARCHIVED") onAction("archive", propertyFile.id);
            else if (newSt === "SOLD") onAction("sold", propertyFile.id);
          }}
        />
      )}
    </div>
  );
}


export { PropertyFileDetailPage };
