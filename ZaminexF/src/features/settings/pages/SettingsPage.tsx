import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cx } from "../../../shared/lib/utils";
import { Page, Role, Property, PropertyFile, FollowUp, ConsultantItem, BadgeV, FollowUpCreatePayload } from "../../../shared/lib/types";
import { fmtShort, toPersianType, toPersianDeal, toPersianPropertyStatus, toPersianTaskStatus, toPersianTaskType, toPersianPriority, toPersianChannel, propertyStatusToUI, toPersianFollowupType, toPersianPropertyFileStatus } from "../../../shared/lib/utils";
import { Badge } from "../../../shared/components/ui/Badge";
import { Btn } from "../../../shared/components/ui/Btn";
import { Input } from "../../../shared/components/ui/Input";
import { Card } from "../../../shared/components/ui/Card";
import { SelectField } from "../../../shared/components/ui/SelectField";
import { ProfileAvatar } from "../../../shared/components/ui/ProfileAvatar";
import { KpiCard } from "../../../shared/components/ui/KpiCard";
import { EmptyState } from "../../../shared/components/ui/EmptyState";
import { PageHeader } from "../../../shared/components/ui/PageHeader";
import CrmPages from "../../crm/CrmPages";
import { ConfirmModal } from "../../../shared/components/ConfirmModal";
import { Pagination } from "../../../shared/components/Pagination";
import { DistrictCombobox } from "../../../shared/components/ui/DistrictCombobox";
import { apiFetch, readJson, apiErrorMessage, getCsrfToken } from "../../../shared/lib/apiClient";
import { toast } from "../../../shared/lib/utils";
import { pageIsAllowed, usePermissions } from "../../../shared/lib/permissions";
import { getSettingsEntries } from "../../../shared/lib/navigation";
import GuidePage from "../../guide/GuidePage";
import { applyBrandTheme, BRAND_THEMES, normalizeBrandTheme, type BrandThemeId } from "../../../shared/lib/appTheme";
import { Building2, LayoutDashboard, FileText, CheckSquare, Users, BarChart3, Settings, Bell, Search, LogOut, Plus, ChevronLeft, ChevronDown, ChevronRight, Clock, CheckCircle2, AlertCircle, MoreHorizontal, MapPin, Eye, Edit2, Trash2, Archive, Phone, Mail, Calendar, TrendingUp, Activity, Command, Star, List, LayoutGrid, Download, Shield, User, Lock, Key, RefreshCw, Circle, Zap, Target, Award, Upload, Check, AlertTriangle, Info, XCircle, Loader2, CircleCheck, TriangleAlert, Columns, Send, BellRing, X, ChevronUp, SlidersHorizontal, ArrowUpRight, Layers, MessageSquare, Sparkles, GripVertical, MoreVertical, Building, History, Flame, Image, Filter, Smartphone } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, ReferenceLine, ScatterChart, Scatter, ZAxis, RadialBarChart, RadialBar } from "recharts";
type CompanyForm = {
  companyName: string;
  licenseNumber: string;
  email: string;
  phone: string;
  address: string;
  brandTheme: BrandThemeId;
};

const EMPTY_COMPANY: CompanyForm = {
  companyName: "",
  licenseNumber: "",
  email: "",
  phone: "",
  address: "",
  brandTheme: "green",
};

function SettingsPage({ page, navigate, role, csrfToken }: { page: Page; navigate: (p: Page) => void; role: Role; csrfToken: string }) {
  const { can, permissions } = usePermissions();
  const visibleTabs = getSettingsEntries(role, permissions);
  const canEditPermissions = role === "admin";
  const canEditCompany = can("company.edit");
  const canManageLogin = can("login.settings");

  type PermissionItem = {
    code: string;
    label: string;
    group: string;
    groupOrder: number;
    order: number;
  };
  type MatrixRole = {
    code: string;
    name: string;
    isLocked: boolean;
    isCustom?: boolean;
    permissions: string[];
  };
  const [permissionItems, setPermissionItems] = useState<PermissionItem[]>([]);
  const [matrixRoles, setMatrixRoles] = useState<MatrixRole[]>([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [permissionSaving, setPermissionSaving] = useState<string | null>(null);
  const [roleFormOpen, setRoleFormOpen] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [roleSaving, setRoleSaving] = useState(false);

  type RangeUser = { id: number; username: string; name: string; role: string };
  type RangeItem = {
    id: number;
    name: string;
    is_active: boolean;
    managers: RangeUser[];
    members: RangeUser[];
  };
  const [ranges, setRanges] = useState<RangeItem[]>([]);
  const [rangeManagers, setRangeManagers] = useState<RangeUser[]>([]);
  const [rangeMembers, setRangeMembers] = useState<RangeUser[]>([]);
  const [rangeForm, setRangeForm] = useState({ name: "", managerIds: [] as string[], memberIds: [] as string[] });
  const [editingRangeId, setEditingRangeId] = useState<number | null>(null);
  const [rangeSaving, setRangeSaving] = useState(false);
  const [rangesLoading, setRangesLoading] = useState(false);

  const [company, setCompany] = useState<CompanyForm>(EMPTY_COMPANY);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companySaving, setCompanySaving] = useState(false);

  const [loginMethod, setLoginMethod] = useState<"password" | "sms">("password");
  const [selectedMethod, setSelectedMethod] = useState<"password" | "sms">("password");
  const [smsConfigured, setSmsConfigured] = useState(false);
  const [loginOptionsLoading, setLoginOptionsLoading] = useState(false);
  const [savingLoginMethod, setSavingLoginMethod] = useState(false);

  useEffect(() => {
    if (!pageIsAllowed(page, role, permissions)) navigate("settings-workspace");
  }, [page, role, permissions, navigate]);

  useEffect(() => {
    if (page !== "settings-workspace") return;
    let cancelled = false;
    setCompanyLoading(true);
    (async () => {
      try {
        const res = await apiFetch("/common/api/company-settings/", { method: "GET" }, csrfToken);
        const data = await readJson(res);
        if (cancelled) return;
        if (!res.ok) throw new Error(apiErrorMessage(data, "خطا در دریافت تنظیمات شرکت"));
        setCompany({
          companyName: data.companyName ?? "",
          licenseNumber: data.licenseNumber ?? "",
          email: data.email ?? "",
          phone: data.phone ?? "",
          address: data.address ?? "",
          brandTheme: normalizeBrandTheme(data.brandTheme),
        });
      } catch (err: any) {
        if (cancelled) return;
        setCompany(EMPTY_COMPANY);
        toast({ type: "error", message: err?.message || "خطا در دریافت تنظیمات شرکت" });
      } finally {
        if (!cancelled) setCompanyLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [page, csrfToken]);

  const setCompanyField = (k: keyof CompanyForm, v: string) =>
    setCompany((current) => ({ ...current, [k]: v } as CompanyForm));

  const loadLoginOptions = useCallback(async () => {
    setLoginOptionsLoading(true);
    try {
      const res = await apiFetch("/accounts/login-options/", { method: "GET" }, csrfToken);
      const data = await readJson(res);
      if (!res.ok) throw new Error(apiErrorMessage(data, "خطا در دریافت گزینه‌های ورود"));
      const method = data.method === "sms" ? "sms" : "password";
      setLoginMethod(method);
      setSelectedMethod(method);
      setSmsConfigured(Boolean(data.smsConfigured));
    } catch (err: any) {
      toast({ type: "error", message: err?.message || "خطا در دریافت گزینه‌های ورود" });
    } finally {
      setLoginOptionsLoading(false);
    }
  }, [csrfToken]);

  useEffect(() => {
    if (page !== "settings-login-options" || !canManageLogin) return;
    loadLoginOptions();
  }, [page, canManageLogin, loadLoginOptions]);

  const saveLoginMethod = async () => {
    if (selectedMethod === loginMethod) return;
    setSavingLoginMethod(true);
    try {
      const res = await apiFetch(
        "/accounts/login-options/",
        { method: "PATCH", body: JSON.stringify({ method: selectedMethod }) },
        csrfToken,
      );
      const data = await readJson(res);
      if (!res.ok) throw new Error(apiErrorMessage(data, "خطا در ذخیره گزینه ورود"));
      setLoginMethod(selectedMethod);
      setSmsConfigured(Boolean(data.smsConfigured));
      toast({
        type: "success",
        message: selectedMethod === "sms" ? "ورود با کد پیامکی فعال شد." : "ورود با رمز عبور فعال شد.",
      });
    } catch (err: any) {
      toast({ type: "error", message: err?.message || "خطا در ذخیره گزینه ورود" });
    } finally {
      setSavingLoginMethod(false);
    }
  };

  useEffect(() => {
    if (page !== "settings-permissions") return;
    let cancelled = false;
    setPermissionsLoading(true);
    (async () => {
      try {
        const res = await apiFetch("/accounts/role-permissions/", { method: "GET" }, csrfToken);
        const data = await readJson(res);
        if (cancelled) return;
        if (!res.ok) throw new Error(apiErrorMessage(data, "خطا در دریافت دسترسی‌ها"));
        setPermissionItems(Array.isArray(data.permissions) ? data.permissions : []);
        setMatrixRoles(Array.isArray(data.roles) ? data.roles : []);
      } catch (err: any) {
        if (cancelled) return;
        toast({ type: "error", message: err?.message || "خطا در دریافت دسترسی‌ها" });
      } finally {
        if (!cancelled) setPermissionsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [page, csrfToken]);

  const createRole = async () => {
    const name = roleName.trim();
    if (!name) {
      toast({ type: "error", message: "نام نقش را وارد کنید." });
      return;
    }
    setRoleSaving(true);
    try {
      const res = await apiFetch(
        "/accounts/role-permissions/",
        { method: "POST", body: JSON.stringify({ name }) },
        csrfToken,
      );
      const data = await readJson(res);
      if (!res.ok) throw new Error(apiErrorMessage(data, "خطا در ثبت نقش"));
      setPermissionItems(Array.isArray(data.permissions) ? data.permissions : []);
      setMatrixRoles(Array.isArray(data.roles) ? data.roles : []);
      setRoleName("");
      setRoleFormOpen(false);
      toast({ type: "success", message: "نقش ثبت شد." });
    } catch (err: any) {
      toast({ type: "error", message: err?.message || "خطا در ثبت نقش" });
    } finally {
      setRoleSaving(false);
    }
  };

  const toggleRolePermission = async (roleCode: string, permissionCode: string) => {
    if (!canEditPermissions) return;
    const roleRow = matrixRoles.find((item) => item.code === roleCode);
    if (!roleRow || roleRow.isLocked) return;
    const nextPermissions = roleRow.permissions.includes(permissionCode)
      ? roleRow.permissions.filter((code) => code !== permissionCode)
      : [...roleRow.permissions, permissionCode];
    setMatrixRoles((current) =>
      current.map((item) =>
        item.code === roleCode ? { ...item, permissions: nextPermissions } : item
      )
    );
    setPermissionSaving(roleCode);
    try {
      const res = await apiFetch(
        "/accounts/role-permissions/",
        { method: "PATCH", body: JSON.stringify({ role: roleCode, permissions: nextPermissions }) },
        csrfToken,
      );
      const data = await readJson(res);
      if (!res.ok) throw new Error(apiErrorMessage(data, "خطا در ذخیره دسترسی"));
      setPermissionItems(Array.isArray(data.permissions) ? data.permissions : []);
      setMatrixRoles(Array.isArray(data.roles) ? data.roles : []);
      toast({ type: "success", message: "دسترسی‌ها ذخیره شد." });
    } catch (err: any) {
      setMatrixRoles((current) =>
        current.map((item) =>
          item.code === roleCode ? { ...item, permissions: roleRow.permissions } : item
        )
      );
      toast({ type: "error", message: err?.message || "خطا در ذخیره دسترسی" });
    } finally {
      setPermissionSaving(null);
    }
  };

  useEffect(() => {
    if (page !== "settings-ranges") return;
    let cancelled = false;
    setRangesLoading(true);
    (async () => {
      try {
        const res = await apiFetch("/accounts/ranges/", { method: "GET" }, csrfToken);
        const data = await readJson(res);
        if (cancelled) return;
        if (!res.ok) throw new Error(apiErrorMessage(data, "خطا در دریافت رنج‌ها"));
        setRanges(Array.isArray(data) ? data : data.results || []);
        if (canEditPermissions) {
          const usersRes = await apiFetch("/accounts/range-users/", { method: "GET" }, csrfToken);
          const usersData = await readJson(usersRes);
          if (cancelled) return;
          if (usersRes.ok) {
            setRangeManagers(usersData.managers || []);
            setRangeMembers(usersData.members || []);
          }
        }
      } catch (err: any) {
        if (!cancelled) toast({ type: "error", message: err?.message || "خطا در دریافت رنج‌ها" });
      } finally {
        if (!cancelled) setRangesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [page, csrfToken, canEditPermissions]);

  const resetRangeForm = () => {
    setRangeForm({ name: "", managerIds: [], memberIds: [] });
    setEditingRangeId(null);
  };

  const startRangeEdit = (range: RangeItem) => {
    setEditingRangeId(range.id);
    setRangeForm({
      name: range.name,
      managerIds: range.managers.map((manager) => String(manager.id)),
      memberIds: range.members.map((member) => String(member.id)),
    });
  };

  const saveRange = async () => {
    if (!canEditPermissions) return;
    if (!rangeForm.name.trim()) {
      toast({ type: "error", message: "نام رنج را وارد کنید." });
      return;
    }
    setRangeSaving(true);
    try {
      const payload = {
        name: rangeForm.name.trim(),
        manager_ids: rangeForm.managerIds.map(Number),
        member_ids: rangeForm.memberIds.map(Number),
      };
      const res = await apiFetch(
        editingRangeId ? `/accounts/ranges/${editingRangeId}/` : "/accounts/ranges/",
        { method: editingRangeId ? "PATCH" : "POST", body: JSON.stringify(payload) },
        csrfToken,
      );
      const data = await readJson(res);
      if (!res.ok) throw new Error(apiErrorMessage(data, "خطا در ذخیره رنج"));
      setRanges((current) =>
        editingRangeId
          ? current.map((item) => (item.id === data.id ? data : item))
          : [...current, data],
      );
      resetRangeForm();
      toast({ type: "success", message: "رنج ذخیره شد." });
    } catch (err: any) {
      toast({ type: "error", message: err?.message || "خطا در ذخیره رنج" });
    } finally {
      setRangeSaving(false);
    }
  };

  const deleteRange = async (range: RangeItem) => {
    if (!canEditPermissions) return;
    try {
      const res = await apiFetch(`/accounts/ranges/${range.id}/`, { method: "DELETE" }, csrfToken);
      if (!res.ok && res.status !== 204) {
        const data = await readJson(res).catch(() => null);
        throw new Error(apiErrorMessage(data, "خطا در حذف رنج"));
      }
      setRanges((current) => current.filter((item) => item.id !== range.id));
      if (editingRangeId === range.id) resetRangeForm();
      toast({ type: "success", message: "رنج حذف شد." });
    } catch (err: any) {
      toast({ type: "error", message: err?.message || "خطا در حذف رنج" });
    }
  };

  const saveCompany = async () => {
    try {
      setCompanySaving(true);
      const res = await apiFetch("/common/api/company-settings/", { method: "PATCH", body: JSON.stringify(company) }, csrfToken);
      const data = await readJson(res);
      if (!res.ok) throw new Error(apiErrorMessage(data, "خطا در ذخیره تنظیمات"));
      setCompany({
        companyName: data.companyName ?? "",
        licenseNumber: data.licenseNumber ?? "",
        email: data.email ?? "",
        phone: data.phone ?? "",
        address: data.address ?? "",
        brandTheme: normalizeBrandTheme(data.brandTheme),
      });
      applyBrandTheme(data.brandTheme);
      toast({ type: "success", message: "تنظیمات ذخیره شد." });
    } catch (err: any) {
      toast({ type: "error", message: err?.message || "خطا در ذخیره تنظیمات" });
    } finally {
      setCompanySaving(false);
    }
  };
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader title="تنظیمات" />
      <div role="tablist" aria-label="بخش‌های تنظیمات" className="flex flex-wrap gap-1 border-b border-border mb-5">{visibleTabs.map((t) => <button role="tab" aria-selected={page === t.page} key={t.page} onClick={() => navigate(t.page)} className={cx("px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors", page === t.page ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>{t.label}</button>)}</div>
      {page === "settings-workspace" && (
        <Card className="p-6 space-y-4">
          <h2 className="text-sm font-semibold">اطلاعات شرکت</h2>
          {companyLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin text-primary" />
              در حال بارگذاری تنظیمات…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4"><Input label="نام شرکت" value={company.companyName} onChange={(v) => setCompanyField("companyName", v)} readOnly={!canEditCompany} /><Input label="شماره پروانه کسب اتحادیه" value={company.licenseNumber} onChange={(v) => setCompanyField("licenseNumber", v)} readOnly={!canEditCompany} /><Input label="ایمیل ثبت‌شده" value={company.email} onChange={(v) => setCompanyField("email", v)} readOnly={!canEditCompany} /><Input label="تلفن دفتر" value={company.phone} onChange={(v) => setCompanyField("phone", v)} readOnly={!canEditCompany} /></div>
              <Input label="آدرس دفتر" value={company.address} onChange={(v) => setCompanyField("address", v)} textarea rows={2} readOnly={!canEditCompany} />
              <fieldset className="space-y-3 rounded-xl border border-border p-4" disabled={!canEditCompany}>
                <legend className="px-1 text-sm font-semibold">رنگ سازمانی همه کاربران</legend>
                <p className="text-xs leading-6 text-muted-foreground">این پالت برای کل فضای کاری ذخیره می‌شود؛ حالت روشن/تیرهٔ هر کاربر مستقل می‌ماند.</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {BRAND_THEMES.map((theme) => (
                    <label key={theme.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-border p-3 transition hover:bg-secondary/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:disabled]:cursor-not-allowed">
                      <input
                        type="radio"
                        name="brandTheme"
                        value={theme.id}
                        checked={company.brandTheme === theme.id}
                        disabled={!canEditCompany || companyLoading || companySaving}
                        onChange={() => setCompany((current) => ({ ...current, brandTheme: theme.id }))}
                        aria-label={theme.name}
                        className="accent-primary"
                      />
                      <span aria-hidden="true" className="h-6 w-6 shrink-0 rounded-full ring-2 ring-white shadow" style={{ backgroundColor: theme.color }} />
                      <span className="text-xs font-medium">{theme.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {canEditCompany && <Btn variant="primary" onClick={saveCompany} disabled={companySaving || companyLoading}><Check size={13} />{companySaving ? "در حال ذخیره…" : "ذخیره تغییرات"}</Btn>}
            </>
          )}
        </Card>
      )}
      {page === "settings-permissions" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-start gap-2">
            {canEditPermissions && (
              <Btn variant="primary" size="sm" onClick={() => setRoleFormOpen((value) => !value)}>
                <Plus size={13} />افزودن نقش
              </Btn>
            )}
            <p className="text-xs text-muted-foreground leading-relaxed">
              دسترسی هر نقش در این جدول نمایش داده می‌شود. تغییرات فقط توسط مدیر و از همین جدول اعمال می‌شود و بلافاصله برای کاربران همان نقش اثر می‌کند.
            </p>
          </div>
          {canEditPermissions && roleFormOpen && (
            <Card className="p-4">
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-full sm:w-56"><Input label="نام نقش" placeholder="مثلاً کارشناس پشتیبانی" value={roleName} onChange={setRoleName} /></div>
                <Btn variant="primary" size="sm" onClick={createRole} disabled={roleSaving}>
                  <Check size={13} />{roleSaving ? "در حال ثبت…" : "ثبت نقش"}
                </Btn>
                <Btn variant="secondary" size="sm" onClick={() => { setRoleFormOpen(false); setRoleName(""); }} disabled={roleSaving}>
                  انصراف
                </Btn>
              </div>
            </Card>
          )}
          {permissionsLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin text-primary" />
              در حال بارگذاری دسترسی‌ها…
            </div>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-secondary/30">
                    <tr>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">دسترسی</th>
                      {matrixRoles.map((roleRow) => (
                        <th key={roleRow.code} className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">
                          <span>{roleRow.name}</span>
                          {roleRow.isLocked && <span className="block mt-1 text-[10px] font-normal text-muted-foreground/70">کامل و ثابت</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {Array.from(
                      permissionItems.reduce((groups, item) => {
                        const rows = groups.get(item.group) || [];
                        rows.push(item);
                        groups.set(item.group, rows);
                        return groups;
                      }, new Map<string, PermissionItem[]>()),
                    ).map(([group, items]) => (
                      <React.Fragment key={group}>
                        <tr className="bg-secondary/20">
                          <td colSpan={matrixRoles.length + 1} className="px-4 py-2 text-xs font-semibold text-primary">{group}</td>
                        </tr>
                        {items.map((item) => (
                          <tr key={item.code} className="hover:bg-secondary/30">
                            <td className="px-4 py-3 text-xs font-medium">{item.label}</td>
                            {matrixRoles.map((roleRow) => {
                              const allowed = roleRow.permissions.includes(item.code);
                              return (
                                <td key={roleRow.code} className="px-4 py-3 text-center">
                                  {!canEditPermissions || roleRow.isLocked ? (
                                    allowed
                                      ? <CheckCircle2 size={14} className="text-emerald-500 dark:text-emerald-300 mx-auto" />
                                      : <XCircle size={14} className="text-muted-foreground/30 mx-auto" />
                                  ) : (
                                    <input
                                      type="checkbox"
                                      checked={allowed}
                                      disabled={permissionSaving === roleRow.code}
                                      onChange={() => toggleRolePermission(roleRow.code, item.code)}
                                      className="h-4 w-4 accent-primary cursor-pointer disabled:cursor-wait"
                                      aria-label={`${item.label} برای ${roleRow.name}`}
                                    />
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
      {page === "settings-ranges" && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">مدیریت رنج‌ها</h2>
            {rangesLoading && <Loader2 size={14} className="animate-spin text-primary" />}
          </div>
          {canEditPermissions && (
            <div className="space-y-3 rounded-xl border border-border p-4">
              <Input
                label="نام رنج"
                value={rangeForm.name}
                onChange={(v) => setRangeForm((current) => ({ ...current, name: v }))}
              />
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium">
                  مدیران رنج
                  <select
                    multiple
                    value={rangeForm.managerIds}
                    onChange={(event) =>
                      setRangeForm((current) => ({
                        ...current,
                        managerIds: Array.from(event.target.selectedOptions).map((option) => option.value),
                      }))
                    }
                    className="mt-1.5 w-full min-h-24 rounded-xl border border-border bg-background p-2 text-xs"
                  >
                    {rangeManagers.map((manager) => (
                      <option key={manager.id} value={manager.id}>{manager.name} ({manager.username})</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-medium">
                  کارشناسان رنج
                  <select
                    multiple
                    value={rangeForm.memberIds}
                    onChange={(event) =>
                      setRangeForm((current) => ({
                        ...current,
                        memberIds: Array.from(event.target.selectedOptions).map((option) => option.value),
                      }))
                    }
                    className="mt-1.5 w-full min-h-24 rounded-xl border border-border bg-background p-2 text-xs"
                  >
                    {rangeMembers.map((member) => (
                      <option key={member.id} value={member.id}>{member.name} ({member.username})</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex gap-2">
                <Btn variant="primary" size="sm" onClick={saveRange} disabled={rangeSaving}>
                  <Check size={13} />{rangeSaving ? "در حال ذخیره…" : editingRangeId ? "ذخیره تغییرات" : "افزودن رنج"}
                </Btn>
                {editingRangeId && (
                  <Btn variant="secondary" size="sm" onClick={resetRangeForm}>انصراف</Btn>
                )}
              </div>
            </div>
          )}
          <div className="space-y-2">
            {ranges.length === 0 ? (
              <p className="text-xs text-muted-foreground">رنجی ثبت نشده است.</p>
            ) : (
              ranges.map((range) => (
                <div key={range.id} className="flex items-start justify-between gap-3 rounded-xl border border-border p-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">{range.name}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      مدیران: {range.managers.map((item) => item.name).join("، ") || "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      کارشناسان: {range.members.map((item) => item.name).join("، ") || "—"}
                    </p>
                  </div>
                  {canEditPermissions && (
                    <div className="flex gap-1.5 flex-shrink-0">
                      <Btn variant="secondary" size="xs" onClick={() => startRangeEdit(range)}>
                        <Edit2 size={12} />ویرایش
                      </Btn>
                      <Btn variant="danger" size="xs" onClick={() => deleteRange(range)}>
                        <Trash2 size={12} />حذف
                      </Btn>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>
      )}
      {page === "settings-login-options" && canManageLogin && (
        <Card className="p-6 space-y-5">
          <div>
            <h2 className="text-sm font-semibold">گزینه‌های ورود</h2>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">مشخص کنید کاربران با رمز عبور وارد سامانه شوند یا با کد پیامکی یک‌بارمصرف. این انتخاب بلافاصله برای کل سامانه اعمال می‌شود.</p>
          </div>
          {loginOptionsLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin text-primary" />در حال بارگذاری گزینه‌های ورود…</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { key: "password" as const, icon: <Lock size={16} />, title: "ورود با رمز عبور", desc: "کاربر با نام کاربری و رمز عبور وارد سامانه می‌شود." },
                  { key: "sms" as const, icon: <Smartphone size={16} />, title: "ورود با کد پیامکی", desc: "کد تأیید یک‌بارمصرف به شماره موبایل ثبت‌شدهٔ کاربر پیامک می‌شود." },
                ].map((opt) => (
                  <button key={opt.key} type="button" onClick={() => setSelectedMethod(opt.key)} className={cx("rounded-xl border p-4 text-right transition-all", selectedMethod === opt.key ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border hover:border-primary/40")}>
                    <div className="flex items-center gap-2 mb-1.5"><span className={selectedMethod === opt.key ? "text-primary" : "text-muted-foreground"}>{opt.icon}</span><span className="text-sm font-semibold">{opt.title}</span></div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{opt.desc}</p>
                  </button>
                ))}
              </div>
              {selectedMethod === "sms" && !smsConfigured && (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-500/12 border border-amber-200 dark:border-amber-500/35 p-4 text-xs text-amber-700 dark:text-amber-300 leading-relaxed">تنظیمات سرویس پیامک (کلید API و شناسه قالب) هنوز تکمیل نشده است؛ تا وقتی این مقادیر وارد نشوند، ارسال کد تأیید ممکن نیست.</div>
              )}
              <div className="flex items-center justify-between gap-2 pt-3 border-t border-border">
                <span className="text-xs text-muted-foreground">روش ورود فعال: {loginMethod === "sms" ? "کد پیامکی" : "رمز عبور"}</span>
                <Btn variant="primary" onClick={saveLoginMethod} disabled={savingLoginMethod || loginOptionsLoading || selectedMethod === loginMethod}><Check size={13} />{savingLoginMethod ? "در حال ذخیره…" : "ذخیره گزینه ورود"}</Btn>
              </div>
            </>
          )}
        </Card>
      )}
      {page === "guide" && <GuidePage role={role} navigate={navigate} />}
      {page === "crm-settings" && <CrmPages csrfToken={csrfToken} page={page} role={role} navigate={navigate} embedded />}
      {page === "crm-deal-types" && <CrmPages csrfToken={csrfToken} page={page} role={role} navigate={navigate} embedded />}
    </div>
  );
}


export { SettingsPage };
