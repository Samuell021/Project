import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

import { Sidebar } from "../features/auth/Sidebar";
import { TopBar } from "../features/auth/TopBar";

const LoginPage = React.lazy(() => import("../features/auth/LoginPage").then((module) => ({ default: module.LoginPage })));
const AdminDashboard = React.lazy(() => import("../features/dashboard/AdminDashboard").then((module) => ({ default: module.AdminDashboard })));
const ConsultantDashboard = React.lazy(() => import("../features/dashboard/pages/ConsultantDashboard").then((module) => ({ default: module.ConsultantDashboard })));
const PropertiesPage = React.lazy(() => import("../features/properties/PropertiesPage").then((module) => ({ default: module.PropertiesPage })));
const PropertyDetail = React.lazy(() => import("../features/properties/pages/PropertyDetail").then((module) => ({ default: module.PropertyDetail })));
const PropertyReportsPage = React.lazy(() => import("../features/properties/pages/PropertyReportsPage").then((module) => ({ default: module.PropertyReportsPage })));
const AddPropertyWizard = React.lazy(() => import("../features/properties/components/AddPropertyWizard").then((module) => ({ default: module.AddPropertyWizard })));
const EditPropertyWizard = React.lazy(() => import("../features/properties/components/EditPropertyWizard").then((module) => ({ default: module.EditPropertyWizard })));
const PropertyFilesPage = React.lazy(() => import("../features/propertyFiles/pages/PropertyFilesPage").then((module) => ({ default: module.PropertyFilesPage })));
const PropertyFileDetailPage = React.lazy(() => import("../features/propertyFiles/pages/PropertyFileDetailPage").then((module) => ({ default: module.PropertyFileDetailPage })));
const CreatePropertyFileWizard = React.lazy(() => import("../features/propertyFiles/components/CreatePropertyFileWizard").then((module) => ({ default: module.CreatePropertyFileWizard })));
const StatusChangeModal = React.lazy(() => import("../features/propertyFiles/components/StatusChangeModal").then((module) => ({ default: module.StatusChangeModal })));
const TasksWorkspacePage = React.lazy(() => import("../features/tasks/pages/TasksWorkspacePage"));
const ConsultantsPage = React.lazy(() => import("../features/consultants/pages/ConsultantsPage").then((module) => ({ default: module.ConsultantsPage })));
const ConsultantAnalyticsSection = React.lazy(() => import("../features/consultants/components/ConsultantAnalyticsSection").then((module) => ({ default: module.ConsultantAnalyticsSection })));
const AddConsultantPage = React.lazy(() => import("../features/consultants/components/AddConsultantPage").then((module) => ({ default: module.AddConsultantPage })));
const EditConsultantPage = React.lazy(() => import("../features/consultants/components/EditConsultantPage").then((module) => ({ default: module.EditConsultantPage })));
const FollowUpsPage = React.lazy(() => import("../features/followups/pages/FollowUpsPage").then((module) => ({ default: module.FollowUpsPage })));
const CreateFollowUp = React.lazy(() => import("../features/followups/components/CreateFollowUp").then((module) => ({ default: module.CreateFollowUp })));
const TicketsPage = React.lazy(() => import("../features/tickets/pages/TicketsPage").then((module) => ({ default: module.TicketsPage })));
const MyProfilePage = React.lazy(() => import("../features/profile/pages/MyProfilePage").then((module) => ({ default: module.MyProfilePage })));
const MyPropertiesPage = React.lazy(() => import("../features/properties/pages/MyPropertiesPage").then((module) => ({ default: module.MyPropertiesPage })));
const DistrictsPage = React.lazy(() => import("../features/districts/pages/DistrictsPage").then((module) => ({ default: module.DistrictsPage })));
const AttributesPage = React.lazy(() => import("../features/attributes/pages/AttributesPage").then((module) => ({ default: module.AttributesPage })));
const NotificationsRecordsPage = React.lazy(() => import("../features/activity/pages/NotificationsRecordsPage").then((module) => ({ default: module.NotificationsRecordsPage })));
const SettingsPage = React.lazy(() => import("../features/settings/pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const CrmPages = React.lazy(() => import("../features/crm/CrmPages"));

import { ToastContainer } from "../shared/components/ui/ToastContainer";
import { ConfirmModal } from "../shared/components/ConfirmModal";
import { CommandPalette } from "../shared/components/CommandPalette";
import { NotifDrawer } from "../shared/components/NotifDrawer";
import { EmptyState } from "../shared/components/ui/EmptyState";

import type { Page, Role, Property, PropertyReportPayload, BadgeV, TaskHistoryEntry, ConsultantItem, FollowUp, FollowUpCreatePayload, PropertyFile } from "../shared/lib/types";
import { PAGE_SIZE, TRANSACTION_TYPES, PROPERTY_STATUSES, PROPERTY_STATUS_TO_BACKEND, PROPERTY_FILE_STATUSES, TASK_TYPES, TASK_STATUSES, TASK_PRIORITIES, DASH_AREA, CHANNEL_PIE, PIE_COLORS, SKILL_RADAR, CHART_COLORS, DELEGATION_COLORS } from "../shared/lib/constants";
import { fmtShort, cx, requiredFieldMsg, propertyStatusToUI, toPersianType, toPersianDeal, toPersianPropertyStatus, toPersianPropertyFileStatus, toPersianTaskType, toPersianTaskStatus, toPersianPriority, toPersianFollowupType, toPersianChannel, formatPriceDeviation, delegationLabel, toast, isFollowUpOverdue } from "../shared/lib/utils";
import { apiFetch, readJson, apiErrorMessage, onSessionExpired, beginIntentionalLogout, SESSION_EXPIRED_MESSAGE } from "../shared/lib/apiClient";
import { buildAppPath, getPageTitle, parseAppLocation } from "../shared/lib/appRouting";
import { PermissionProvider, pageIsAllowed } from "../shared/lib/permissions";
import { subscribeSupplyCountersRefresh } from "../features/crm/lib/supplyDomain";

export type { Page, Role, Property, PropertyReportPayload, BadgeV };

type InitialData = {
  isAuthenticated: boolean;
  loginUrl: string;
  logoutUrl: string;
  csrfToken: string;
  role: Role | null;
  roleLabel?: string;
  roleCode?: string;
  permissions?: string[];
  rangeNames?: string[];
  userName: string;
  currentConsultantId: string | null;
  initialPage: string;
  next: string;
  pageProps?: {
    properties?: Property[];
    property?: Property;
    propertyData?: { id?: string | number };
    consultants?: any[];
    items?: any[];
    pagination?: {
      currentPage: number;
      totalPages: number;
      totalItems: number;
      hasNext: boolean;
      hasPrevious: boolean;
    };
    filters?: Record<string, string>;
  };
};

export default function AppRouter({ initialData }: { initialData: InitialData }) {
  const fallbackPage: Page = initialData.initialPage && initialData.initialPage !== "login"
    ? initialData.initialPage === "dashboard"
      ? initialData.role === "consultant" ? "consultant-dashboard" : "admin-dashboard"
      : initialData.initialPage as Page
    : initialData.isAuthenticated
      ? initialData.role === "consultant" ? "consultant-dashboard" : "admin-dashboard"
      : "login";
  const initialRoute = parseAppLocation(window.location.pathname, window.location.search, fallbackPage);
  const legacyPropertyId = initialData.pageProps?.property?.id != null
    ? String(initialData.pageProps.property.id)
    : initialData.pageProps?.propertyData?.id != null
      ? String(initialData.pageProps.propertyData.id)
      : null;

  const [page, setPage] = useState<Page>(initialRoute.page);

  const [currentConsultantId, setCurrentConsultantId] = useState<string | null>(
    initialData.currentConsultantId || null);

  const [role, setRole] = useState<Role>(
    initialData.role ?? "consultant"
  );
  const [permissions, setPermissions] = useState<string[] | null>(initialData.permissions ?? null);
  const [userName, setUserName] = useState(initialData.userName || "کاربر");

  const [consultantFormSubmitting, setConsultantFormSubmitting] = useState(false);
  const [consultantFormError, setConsultantFormError] = useState<string | null>(null);
  const [selectedConsultantId, setSelectedConsultantId] = useState<string | null>(initialRoute.consultantId ?? null);

  const [properties, setProperties] = useState<Property[]>(
    initialData.pageProps?.properties || initialData.pageProps?.items || []);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertiesError, setPropertiesError] = useState<string | null>(null);
  const [locatedProperties, setLocatedProperties] = useState<Property[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(
    initialRoute.propertyId ?? initialRoute.preselectedPropertyId ?? legacyPropertyId
  );
  const [selectedProperty, setSelectedProperty] = useState<Property | undefined>(
    initialData.pageProps?.property
  );
  const [propertyDetailLoading, setPropertyDetailLoading] = useState(false);
  const [propertyDetailError, setPropertyDetailError] = useState<string | null>(null);
  const [selectedPropertyIdForReport, setSelectedPropertyIdForReport] = useState<string | null>(initialRoute.propertyReportId ?? null);
  const [propertyFormSubmitting, setPropertyFormSubmitting] = useState(false);
  const [propertyFormError, setPropertyFormError] = useState<string | null>(null);
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(
    initialRoute.page === "edit-property" ? initialRoute.propertyId ?? legacyPropertyId : null
  );

  const [propertyFiles, setPropertyFiles] = useState<PropertyFile[]>([]);
  const [selectedPropertyFileId, setSelectedPropertyFileId] = useState<string | null>(initialRoute.propertyFileId ?? null);
  const [selectedPropertyFile, setSelectedPropertyFile] = useState<PropertyFile | undefined>(undefined);
  const [propertyFileDetailLoading, setPropertyFileDetailLoading] = useState(false);
  const [propertyFileDetailError, setPropertyFileDetailError] = useState<string | null>(null);
  const [propertyFileFormSubmitting, setPropertyFileFormSubmitting] = useState(false);
  const [propertyFileFormError, setPropertyFileFormError] = useState<string | null>(null);

  const [consultants, setConsultants] = useState<ConsultantItem[]>(
    initialData.pageProps?.consultants || []);

  const [consultantsLoading, setConsultantsLoading] = useState(false);
  const [consultantsError, setConsultantsError] = useState<string | null>(null);

  const [adminProfile, setAdminProfile] = useState<any | null>(null);

  const [followups, setFollowups] = useState<FollowUp[]>([]);
  const [followupsLoading, setFollowupsLoading] = useState(false);
  const [followupsError, setFollowupsError] = useState<string | null>(null);
  const [selectedFollowupId, setSelectedFollowupId] = useState<string | null>(initialRoute.followupId ?? null);
  const [selectedFollowup, setSelectedFollowup] = useState<FollowUp | undefined>(undefined);

  const [tasks, setTasks] = useState<any[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [taskSummary, setTaskSummary] = useState<{ total: number; pending: number; in_progress: number; completed: number; cancelled: number; overdue: number } | null>(null);
  const [taskTypesList, setTaskTypesList] = useState<Array<{ value: string; label: string }>>([]);
  const [myTasksRefreshKey, setMyTasksRefreshKey] = useState(0);
  const bumpMyTasks = useCallback(() => setMyTasksRefreshKey((k) => k + 1), []);

  const [dashboardKpis, setDashboardKpis] = useState({
    totalProperties: 0,
    activePropertyFiles: 0,
    openTasks: 0,
    followUpsDue: 0,
    consultants: 0,
    consultantsActive: 0,
  });
  const [topConsultants, setTopConsultants] = useState<any[]>([]);
  const [revenueMonthly, setRevenueMonthly] = useState<any[]>([]);
  const [revenueDealTypes, setRevenueDealTypes] = useState<Array<{ name: string; label: string }>>([]);
  const [propertyComposition, setPropertyComposition] = useState<any[]>([]);
  const [hotProperties, setHotProperties] = useState<any[]>([]);
  const [myReport, setMyReport] = useState<any | null>(null);
  const [districtsList, setDistrictsList] = useState<string[]>([]);
  const [recentActivities, setRecentActivities] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [ticketUnreadCount, setTicketUnreadCount] = useState(0);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(initialRoute.ticketId ?? null);
  const [selectedCrmRecordId, setSelectedCrmRecordId] = useState<string | null>(initialRoute.crmRecordId ?? null);

  const [collapsed, setCollapsed] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);
  useEffect(() => {
    if (mobileNavOpen) return;
    document.querySelector<HTMLButtonElement>('button[aria-label="منوی اصلی"]')?.focus();
  }, [mobileNavOpen]);
  const mobileNavButton = useRef<HTMLButtonElement | null>(null);

  const navigate = useCallback(
    (p: Page, paramId?: string | number) => {
      const rawId = paramId == null ? "" : String(paramId).trim();
      const id = /^[1-9]\d{0,19}$/.test(rawId) ? rawId : undefined;
      let nextPage = p;
      if (!id) {
        if (p === "property-detail" || p === "edit-property" || p === "property-reports") nextPage = "properties";
        if (p === "property-file-detail" || p === "edit-property-file") nextPage = "property-files";
        if (p === "edit-consultant") nextPage = "consultants";
        if (p === "edit-followup") nextPage = "follow-ups";
      }

      if (nextPage === "create-property-file") {
        setSelectedPropertyId(id ?? null);
      } else if (nextPage === "edit-property-file" || nextPage === "property-file-detail") {
        setSelectedPropertyFileId(id ?? null);
        setSelectedPropertyFile((current) => current && String(current.id) === id ? current : undefined);
      } else if (nextPage === "property-detail" || nextPage === "edit-property") {
        setSelectedPropertyId(id ?? null);
        setSelectedProperty((current) => current && String(current.id) === id ? current : undefined);
        setEditingPropertyId(nextPage === "edit-property" ? id ?? null : null);
      } else if (nextPage === "property-reports") {
        setSelectedPropertyIdForReport(id ?? null);
      } else if (nextPage === "edit-followup") {
        setSelectedFollowupId(id ?? null);
        setSelectedFollowup(undefined);
      } else if (nextPage === "tickets-sent" || nextPage === "tickets-received" || nextPage === "tickets-all") {
        setSelectedTicketId(id ?? null);
      } else if (nextPage === "create-ticket") {
        setSelectedTicketId(null);
      } else if (nextPage === "consultants") {
        setSelectedConsultantId(id ?? null);
      } else if (nextPage === "edit-consultant") {
        setSelectedConsultantId(id ?? null);
      }

      setSelectedCrmRecordId(
        ["crm-property-register", "crm-property-cases", "crm-inquiries", "crm-contacts"].includes(nextPage)
          ? id ? String(id) : null
          : null,
      );
      const destination = buildAppPath(nextPage, id);
      const currentLocation = `${window.location.pathname}${window.location.search}`;
      if (currentLocation !== destination) {
        window.history.pushState({ page: nextPage }, "", destination);
      }
      setPage(nextPage);
      setNotifOpen(false);
      setCmdOpen(false);
    },
    []
  );

  useEffect(() => {
    const handlePopState = () => {
      const nextRoute = parseAppLocation(window.location.pathname, window.location.search, fallbackPage);
      setPage(nextRoute.page);
      setSelectedPropertyId(nextRoute.propertyId ?? nextRoute.preselectedPropertyId ?? null);
      setSelectedPropertyIdForReport(nextRoute.propertyReportId ?? null);
      setEditingPropertyId(nextRoute.page === "edit-property" ? nextRoute.propertyId ?? null : null);
      setSelectedProperty((current) =>
        nextRoute.propertyId && current && String(current.id) === nextRoute.propertyId ? current : undefined
      );
      setSelectedPropertyFileId(nextRoute.propertyFileId ?? null);
      setSelectedPropertyFile((current) =>
        nextRoute.propertyFileId && current && String(current.id) === nextRoute.propertyFileId ? current : undefined
      );
      setSelectedConsultantId(nextRoute.consultantId ?? null);
      setSelectedFollowupId(nextRoute.followupId ?? null);
      setSelectedFollowup(undefined);
      setSelectedTicketId(nextRoute.ticketId ?? null);
      setSelectedCrmRecordId(nextRoute.crmRecordId ?? null);
      setNotifOpen(false);
      setCmdOpen(false);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [fallbackPage]);

  useEffect(() => {
    if (page === "add-property") {
      const target = buildAppPath("crm-property-register");
      if (`${window.location.pathname}${window.location.search}` !== target) {
        window.history.replaceState({ page: "crm-property-register" }, "", target);
      }
      setPage("crm-property-register");
    }
  }, [page]);

  const refreshSupplyCounters = useCallback(async () => {
    if (!initialData.isAuthenticated) return;
    if (role === "admin" || role === "range_manager") {
      try {
        const revRes = await apiFetch("/crm/api/reviews/?decision=PENDING&page_size=1", { method: "GET" }, initialData.csrfToken);
        if (revRes.ok) {
          const revBody = await readJson(revRes);
          const count = Array.isArray(revBody)
            ? revBody.length
            : typeof revBody?.count === "number"
              ? revBody.count
              : Array.isArray(revBody?.results)
                ? revBody.results.length
                : 0;
          setPendingReviewCount(count);
        }
      } catch {
      }
    } else {
      setPendingReviewCount(0);
    }
    try {
      const notifRes = await apiFetch("/common/api/notifications/", { method: "GET" }, initialData.csrfToken);
      if (notifRes.ok) {
        const notifData = await readJson(notifRes);
        const list = Array.isArray(notifData) ? notifData : (notifData?.results || []);
        setNotifications(list);
        setUnreadCount(list.filter((n: { is_read?: boolean; read?: boolean }) => !n.is_read && !n.read).length);
      }
    } catch {
    }
  }, [initialData.isAuthenticated, initialData.csrfToken, role]);

  useEffect(() => {
    void refreshSupplyCounters();
    return subscribeSupplyCountersRefresh(() => {
      void refreshSupplyCounters();
    });
  }, [refreshSupplyCounters, page]);

  useEffect(() => {
    if (!initialData.isAuthenticated) return;
    let cancelled = false;
    const refreshPermissions = async () => {
      try {
        const res = await apiFetch(
          "/crm/api/me/",
          { method: "GET" },
          initialData.csrfToken,
        );
        if (!res.ok) return;
        const data = await readJson(res);
        if (cancelled || !Array.isArray(data.permissions)) return;
        const next = [...data.permissions].sort();
        setPermissions((current) => {
          const currentSorted = current ? [...current].sort() : null;
          if (
            currentSorted
            && currentSorted.length === next.length
            && currentSorted.every((code, index) => code === next[index])
          ) {
            return current;
          }
          return next;
        });
      } catch {
      }
    };
    void refreshPermissions();
    const interval = window.setInterval(refreshPermissions, 20000);
    const handleFocus = () => {
      void refreshPermissions();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [initialData.isAuthenticated, initialData.csrfToken]);

  useEffect(() => {
    if (!initialData.isAuthenticated) return;
    if (pageIsAllowed(page, role, permissions)) return;
    const fallback: Page =
      role === "admin" || (role === "range_manager" && (!permissions || permissions.includes("analytics.view")))
        ? "admin-dashboard"
        : role === "range_manager"
          ? "properties"
          : role === "finance"
            ? "crm-finance"
            : "consultant-dashboard";
    const safePage = pageIsAllowed(fallback, role, permissions) ? fallback : "my-profile";
    if (page !== safePage) navigate(safePage);
  }, [page, role, permissions, navigate, initialData.isAuthenticated]);

  useEffect(() => {
    const detailTitle = page === "property-detail" || page === "edit-property"
      ? selectedProperty?.title
      : page === "property-file-detail" || page === "edit-property-file"
        ? selectedPropertyFile?.title
        : undefined;
    document.title = getPageTitle(page, detailTitle);
  }, [page, selectedProperty?.title, selectedPropertyFile?.title]);

  useEffect(() => {
    if (!initialData.isAuthenticated) return;
    onSessionExpired(() => {
      toast({ type: "error", message: SESSION_EXPIRED_MESSAGE });
      window.setTimeout(() => {
        window.location.assign(initialData.loginUrl || "/accounts/login/");
      }, 2000);
    });
    return () => onSessionExpired(null);
  }, [initialData.isAuthenticated, initialData.loginUrl]);

  const prevPageRef = useRef<Page>(page);
  useEffect(() => {
    const prev = prevPageRef.current;
    prevPageRef.current = page;

    if (prev === "add-property" || prev === "edit-property") {
      setPropertyFormError(null);
    }
    if (prev === "create-property-file" || prev === "edit-property-file") {
      setPropertyFileFormError(null);
    }
    if (prev === "add-consultant" || prev === "edit-consultant") {
      setConsultantFormError(null);
    }
    if (prev === "create-followup" || prev === "edit-followup") {
      setFollowupsError(null);
    }
  }, [page]);

  const isAuthenticated = initialData.isAuthenticated;

  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchTaskTypes = async () => {
      try {
        const res = await apiFetch("/tasks/api/tasks/types/", { method: "GET" }, initialData.csrfToken);
        if (res.ok) {
          const data = await res.json();
          setTaskTypesList(data);
        }
      } catch (err) {
        console.error("Error fetching task types:", err);
      }
    };
    fetchTaskTypes();
  }, [isAuthenticated, initialData.csrfToken]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchDistricts = async () => {
      try {
        const res = await apiFetch("/common/api/districts/", { method: "GET" }, initialData.csrfToken);
        if (res.ok) {
          const data = await res.json();
          setDistrictsList(data);
        }
      } catch (err) {
        console.error("Error fetching districts:", err);
      }
    };
    fetchDistricts();
  }, [isAuthenticated, initialData.csrfToken]);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await apiFetch("/common/api/notifications/", { method: "GET" }, initialData.csrfToken);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (err) {
      console.error("Error fetching notifications:", err);
    }
  }, [initialData.csrfToken]);

  const fetchTicketUnreadCount = useCallback(async () => {
    try {
      const res = await apiFetch("/tickets/api/unread-count/", { method: "GET" }, initialData.csrfToken);
      if (res.ok) {
        const data = await res.json();
        setTicketUnreadCount(Number(data?.count || 0));
      }
    } catch (err) {
      console.error("Error fetching ticket unread count:", err);
    }
  }, [initialData.csrfToken]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchNotifications();
      fetchTicketUnreadCount();
      const interval = setInterval(() => {
        fetchNotifications();
        fetchTicketUnreadCount();
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, fetchNotifications, fetchTicketUnreadCount]);

  const propertyFilesLoading = false;
  const propertyFilesError: string | null = null;

  useEffect(() => {
    if ((page !== "property-file-detail" && page !== "edit-property-file") || !selectedPropertyFileId) return;

    const controller = new AbortController();
    setPropertyFileDetailLoading(true);
    setPropertyFileDetailError(null);
    setSelectedPropertyFile((current) =>
      current && String(current.id) === String(selectedPropertyFileId) ? current : undefined
    );

    async function loadPropertyFileDetail() {
      try {
        const res = await apiFetch(
          `/property-files/api/property-files/${selectedPropertyFileId}/`,
          { method: "GET", signal: controller.signal, cache: "no-store" },
          initialData.csrfToken
        );
        const data = await readJson(res);
        if (!res.ok) throw new Error(apiErrorMessage(data, "خطا در دریافت جزئیات فایل"));
        setSelectedPropertyFile(data);
      } catch (error: any) {
        if (!controller.signal.aborted) {
          setSelectedPropertyFile(undefined);
          setPropertyFileDetailError(error?.message || "خطا در دریافت جزئیات فایل");
        }
      } finally {
        if (!controller.signal.aborted) setPropertyFileDetailLoading(false);
      }
    }

    void loadPropertyFileDetail();
    return () => controller.abort();
  }, [page, selectedPropertyFileId, initialData.csrfToken]);

  const submitPropertyFile = useCallback(
    async (payload: Record<string, any>, propertyFileId?: string | null) => {
      try {
        setPropertyFileFormSubmitting(true);
        setPropertyFileFormError(null);

        const isEdit = Boolean(propertyFileId);
        const url = isEdit
          ? `/property-files/api/property-files/${propertyFileId}/`
          : "/property-files/api/property-files/";
        const method = isEdit ? "PATCH" : "POST";

        const res = await apiFetch(url, { method, body: JSON.stringify(payload) }, initialData.csrfToken);

        const data = await readJson(res);

        if (!res.ok) {
          throw new Error(apiErrorMessage(data, "خطا در ثبت فایل"));
        }

        setSelectedPropertyFile(data);
        setSelectedPropertyFileId(String(data.id));

        setPropertyFiles((prev) => {
          const exists = prev.some((l) => String(l.id) === String(data.id));
          if (exists) {
            return prev.map((l) => (String(l.id) === String(data.id) ? data : l));
          }
          return [data, ...prev];
        });

        return { ok: true, data };
      } catch (error: any) {
        const message = error?.message || "خطا در ثبت اطلاعات فایل";
        setPropertyFileFormError(message);
        return { ok: false, error: message };
      } finally {
        setPropertyFileFormSubmitting(false);
      }
    },
    [initialData.csrfToken]
  );

  const refreshDashboard = useCallback(async () => {
    try {
      const [fres, cres, tres, dashRes, actRes] = await Promise.allSettled([
        apiFetch("/followups/api/followups/", { method: "GET" }, initialData.csrfToken),
        apiFetch("/accounts/consultants/", { method: "GET" }, initialData.csrfToken),
        apiFetch("/tasks/api/tasks/summary/", { method: "GET" }, initialData.csrfToken),
        apiFetch("/common/api/analytics/dashboard/", { method: "GET" }, initialData.csrfToken),
        apiFetch("/common/api/activity-log/?page_size=6&days=30", { method: "GET" }, initialData.csrfToken),
      ]);

      if (fres.status === "fulfilled" && fres.value.ok) {
        const data = await fres.value.json();
        const items = Array.isArray(data) ? data : (data.results ?? []);
        setFollowups(items);
      }

      if (cres.status === "fulfilled" && cres.value.ok) {
        const data = await cres.value.json();
        const items = Array.isArray(data) ? data : (data.results ?? []);
        setConsultants(items);
      }

      if (tres.status === "fulfilled" && tres.value.ok) {
        const data = await tres.value.json();
        setTaskSummary(data);
      }

      if (dashRes.status === "fulfilled" && dashRes.value.ok) {
        const dash = await dashRes.value.json();
        setTopConsultants(dash.topConsultants || []);
        setRevenueMonthly(dash.revenueMonthly || []);
        setRevenueDealTypes(dash.revenueDealTypes || []);
        setPropertyComposition(dash.propertyComposition || []);
        setHotProperties(dash.hotProperties || []);
        setMyReport(dash.myReport || null);
        setLocatedProperties(dash.locatedProperties || []);
        if (dash.kpis) {
          setDashboardKpis({
            totalProperties: dash.kpis.totalProperties ?? 0,
            activePropertyFiles: dash.kpis.activePropertyFiles ?? 0,
            openTasks: dash.kpis.openTasks ?? 0,
            followUpsDue: dash.kpis.followUpsDue ?? 0,
            consultants: dash.kpis.consultants ?? 0,
            consultantsActive: dash.kpis.consultantsActive ?? 0,
          });
        }
      }

      if (actRes.status === "fulfilled" && actRes.value.ok) {
        const actData = await actRes.value.json();
        setRecentActivities(actData.results || []);
      }
    } catch (err) {
      console.error("Failed to refresh dashboard:", err);
    }
  }, [initialData.csrfToken]);

  const handlePropertyFileAction = useCallback(
    async (actionName: "approve" | "reject" | "pause" | "archive" | "unarchive" | "delete" | "sold" | "set_status", propertyFileId: string | number, status?: string, reason?: string) => {
      try {
        const isDelete = actionName === "delete";
        const isTransition = actionName === "approve" || actionName === "reject" || actionName === "set_status";
        const url = isTransition
          ? `/listings/api/listings/${propertyFileId}/transition/`
          : `/property-files/api/property-files/${propertyFileId}/${isDelete ? "" : actionName + "/"}`;
        const method = isDelete ? "DELETE" : "POST";
        const targetStatus = actionName === "approve" ? "ACTIVE" : actionName === "reject" ? "DRAFT" : status;
        const payload = isTransition
          ? { status: targetStatus, reason: reason || "" }
          : undefined;
        const body = payload ? JSON.stringify(payload) : undefined;

        const res = await apiFetch(url, { method, ...(body ? { body } : {}) }, initialData.csrfToken);

        if (!res.ok) {
          const data = await readJson(res);
          throw new Error(apiErrorMessage(data, `عملیات ${actionName} با خطا مواجه شد.`));
        }

        if (isDelete) {
          setPropertyFiles((prev) => prev.filter((l) => String(l.id) !== String(propertyFileId)));
          if (selectedPropertyFileId === String(propertyFileId)) {
            setSelectedPropertyFile(undefined);
            setSelectedPropertyFileId(null);
          }
          toast({ type: "success", message: "فایل با موفقیت حذف شد." });
          navigate("property-files");
        } else {
          const updated = await res.json();
          setPropertyFiles((prev) => prev.map((l) => (String(l.id) === String(propertyFileId) ? updated : l)));
          if (selectedPropertyFileId === String(propertyFileId)) {
            setSelectedPropertyFile(updated);
          }
          toast({ type: "success", message: "وضعیت فایل با موفقیت تغییر کرد." });
          refreshDashboard();
        }
      } catch (err: any) {
        toast({ type: "error", message: err.message || "خطایی رخ داد" });
      }
    },
    [initialData.csrfToken, selectedPropertyFileId, refreshDashboard, navigate]
  );

  const [followupsRefreshKey, setFollowupsRefreshKey] = useState(0);
  const bumpFollowups = useCallback(() => setFollowupsRefreshKey((k) => k + 1), []);

  const fetchFollowups = useCallback(async () => {
    setFollowupsLoading(true);
    setFollowupsError(null);

    try {
      const res = await apiFetch("/followups/api/followups/", { method: "GET" }, initialData.csrfToken);

      if (!res.ok) throw new Error("خطا در دریافت پیگیری‌ها");

      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.results ?? []);
      setFollowups(items);
    } catch (err) {
      setFollowupsError(
        err instanceof Error ? err.message : "خطای ناشناخته در بارگذاری پیگیری‌ها"
      );
    } finally {
      setFollowupsLoading(false);
    }
  }, [initialData.csrfToken]);

  const loadFollowups = useCallback(
    async (filters: {
      type?: string;
      consultantId?: string;
      propertyId?: string;
      scheduledDateFrom?: string;
      scheduledDateTo?: string;
    }): Promise<FollowUp[]> => {
      const params = new URLSearchParams();
      params.set("archived", "false");
      if (filters.type && filters.type !== "all") params.set("type", filters.type);
      if (filters.consultantId) params.set("consultantId", filters.consultantId);
      if (filters.propertyId) params.set("propertyId", filters.propertyId);
      if (filters.scheduledDateFrom) params.set("scheduledDateFrom", filters.scheduledDateFrom);
      if (filters.scheduledDateTo) params.set("scheduledDateTo", filters.scheduledDateTo);
      const res = await apiFetch(
        `/followups/api/followups/?${params.toString()}`,
        { method: "GET" },
        initialData.csrfToken
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(apiErrorMessage(data, "خطا در دریافت پیگیری‌ها"));
      }
      const data = await res.json();
      return Array.isArray(data) ? data : (data.results ?? []);
    },
    [initialData.csrfToken]
  );

  const createFollowup = useCallback(async (payload: FollowUpCreatePayload) => {
    setFollowupsLoading(true);
    setFollowupsError(null);

    try {
      const res = await apiFetch("/followups/api/followups/", { method: "POST", body: JSON.stringify(payload) }, initialData.csrfToken);

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const message = data && typeof data === "object" ? Object.values(data).flat().join(" / ") : "خطا در ثبت پیگیری";
        throw new Error(message);
      }
      await fetchFollowups(); bumpFollowups();
    } catch (err) {
      setFollowupsError(
        err instanceof Error ? err.message : "خطا در ثبت پیگیری"
      );
      throw err;
    } finally {
      setFollowupsLoading(false);
    }
  }, [initialData.csrfToken, fetchFollowups]);

  const archiveFollowup = useCallback(async (id: string) => {
    try {
      const res = await apiFetch(`/followups/api/followups/${id}/archive/`, { method: "POST" }, initialData.csrfToken);
      if (!res.ok) throw new Error("خطا در بایگانی پیگیری");
      toast({ type: "success", message: "پیگیری بایگانی شد." });
      await fetchFollowups(); bumpFollowups();
    } catch (err: any) {
      toast({ type: "error", message: err?.message || "خطای ناشناخته" });
    }
  }, [initialData.csrfToken, fetchFollowups]);

  const deleteFollowup = useCallback(async (id: string) => {
    try {
      const res = await apiFetch(`/followups/api/followups/${id}/`, { method: "DELETE" }, initialData.csrfToken);
      if (!res.ok) throw new Error("خطا در حذف پیگیری");
      toast({ type: "success", message: "پیگیری حذف شد." });
      await fetchFollowups(); bumpFollowups();
    } catch (err: any) {
      toast({ type: "error", message: err?.message || "خطای ناشناخته" });
    }
  }, [initialData.csrfToken, fetchFollowups]);

  const completeFollowup = useCallback(async (id: string, outcome: string, probability: number) => {
    try {
      const res = await apiFetch(`/followups/api/followups/${id}/`, {
        method: "PATCH",
        body: JSON.stringify({ status: "completed", outcome, probability }),
      }, initialData.csrfToken);
      if (!res.ok) throw new Error("خطا در تکمیل پیگیری");
      toast({ type: "success", message: "پیگیری تکمیل شد." });
      await fetchFollowups(); bumpFollowups();
    } catch (err: any) {
      toast({ type: "error", message: err?.message || "خطای ناشناخته" });
    }
  }, [initialData.csrfToken, fetchFollowups]);

  const updateFollowup = useCallback(async (id: string, payload: FollowUpCreatePayload) => {
    setFollowupsLoading(true);
    setFollowupsError(null);
    try {
      const res = await apiFetch(`/followups/api/followups/${id}/`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }, initialData.csrfToken);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const message = data && typeof data === "object" ? Object.values(data).flat().join(" / ") : "خطا در ویرایش پیگیری";
        throw new Error(message);
      }
      const updated = await res.json().catch(() => null);
      if (updated) {
        setFollowups((prev) => prev.map((f) => String(f.id) === String(id) ? updated : f));
        setSelectedFollowup(updated);
      }
      await fetchFollowups(); bumpFollowups();
    } catch (err) {
      setFollowupsError(
        err instanceof Error ? err.message : "خطا در ویرایش پیگیری"
      );
      throw err;
    } finally {
      setFollowupsLoading(false);
    }
  }, [initialData.csrfToken, fetchFollowups]);

  const submitFollowup = useCallback(async (payload: FollowUpCreatePayload, followupId?: string | null) => {
    if (followupId) {
      await updateFollowup(followupId, payload);
      return;
    }
    await createFollowup(payload);
  }, [createFollowup, updateFollowup]);

  const editFollowup = useCallback((id: string) => {
    navigate("edit-followup", id);
  }, [navigate]);

  useEffect(() => {
    if (page !== "consultant-dashboard" && page !== "admin-dashboard") return;
    fetchFollowups();
  }, [page, fetchFollowups]);

  useEffect(() => {
    if (page !== "edit-followup" || !selectedFollowupId) return;
    const existing = followups.find((f) => String(f.id) === String(selectedFollowupId));
    if (existing && (!selectedFollowup || String(selectedFollowup.id) !== String(selectedFollowupId))) {
      setSelectedFollowup(existing);
    }
    if (selectedFollowup && String(selectedFollowup.id) === String(selectedFollowupId)) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await apiFetch(`/followups/api/followups/${selectedFollowupId}/`, { method: "GET", signal: controller.signal }, initialData.csrfToken);
        if (res.ok) {
          const data = await res.json();
          setSelectedFollowup(data);
        }
      } catch (err) {
        console.error("Error fetching follow-up detail:", err);
      }
    })();
    return () => controller.abort();
  }, [page, selectedFollowupId, followups, selectedFollowup, initialData.csrfToken]);

  const fetchConsultants = useCallback(async () => {
    setConsultantsLoading(true);
    setConsultantsError(null);
    try {
      const res = await apiFetch("/accounts/consultants/", { method: "GET" }, initialData.csrfToken);
      if (!res.ok) throw new Error("خطا در دریافت لیست کارشناسان");
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.results ?? []);
      setConsultants(items);
    } catch (error: any) {
      setConsultantsError(error.message || "خطا در بارگذاری");
    } finally {
      setConsultantsLoading(false);
    }
  }, [initialData.csrfToken]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchConsultants();
  }, [isAuthenticated, fetchConsultants]);

  const fetchAdminProfile = useCallback(async () => {
    try {
      const res = await apiFetch("/accounts/admins/me/", { method: "GET" }, initialData.csrfToken);
      if (res.ok) {
        const data = await res.json();
        setAdminProfile(data);
      }
    } catch {
    }
  }, [initialData.csrfToken]);

  useEffect(() => {
    if (isAuthenticated && role === "admin") {
      fetchAdminProfile();
    }
  }, [isAuthenticated, role, fetchAdminProfile]);

  const toggleConsultantActive = useCallback(async (id: string, isActive: boolean) => {
    try {
      const res = await apiFetch(`/accounts/consultants/${id}/`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: isActive }),
      }, initialData.csrfToken);
      if (!res.ok) throw new Error(isActive ? "خطا در فعال‌سازی مجدد کارشناس" : "خطا در بایگانی کارشناس");
      toast({ type: "success", message: isActive ? "کارشناس دوباره فعال شد." : "کارشناس بایگانی شد." });
      await fetchConsultants();
    } catch (err: any) {
      toast({ type: "error", message: err?.message || "خطای ناشناخته" });
    }
  }, [initialData.csrfToken, fetchConsultants]);

  const deleteConsultant = useCallback(async (id: string) => {
    try {
      const res = await apiFetch(`/accounts/consultants/${id}/`, { method: "DELETE" }, initialData.csrfToken);
      if (!res.ok) throw new Error("خطا در حذف کارشناس");
      toast({ type: "success", message: "کارشناس حذف شد." });
      await fetchConsultants();
    } catch (err: any) {
      toast({ type: "error", message: err?.message || "خطای ناشناخته" });
    }
  }, [initialData.csrfToken, fetchConsultants]);

  const editConsultant = useCallback((id: string) => {
    navigate("edit-consultant", id);
  }, [navigate]);

  const submitConsultantUpdate = useCallback(
    async (id: string, payload: Record<string, any>) => {
      setConsultantFormSubmitting(true);
      setConsultantFormError(null);
      try {
        const hasImage = payload.profile_image instanceof File;
        let data: any;

        if (hasImage) {
          const formData = new FormData();
          if (payload.first_name) formData.append("first_name", payload.first_name);
          if (payload.last_name) formData.append("last_name", payload.last_name);
          if (payload.full_name) formData.append("full_name", payload.full_name);
          if (payload.email) formData.append("email", payload.email);
          if (payload.mobile) formData.append("mobile", payload.mobile);
          if (payload.branch) formData.append("branch", payload.branch);
          if (payload.notes !== undefined) formData.append("notes", payload.notes);
          formData.append("profile_image", payload.profile_image);

          const res = await apiFetch(
            `/accounts/consultants/${id}/`,
            { method: "PATCH", body: formData },
            initialData.csrfToken
          );

          data = await readJson(res).catch(() => null);
          if (!res.ok) {
            throw new Error(apiErrorMessage(data, "خطا در ویرایش کارشناس"));
          }
        } else {
          const res = await apiFetch(
            `/accounts/consultants/${id}/`,
            { method: "PATCH", body: JSON.stringify(payload) },
            initialData.csrfToken
          );
          data = await res.json().catch(() => null);
          if (!res.ok) {
            const message = data && typeof data === "object"
              ? Object.values(data).flat().join(" / ")
              : "خطا در ویرایش کارشناس";
            throw new Error(message);
          }
        }

        setConsultants((prev) => prev.map((c) => String(c.id) === String(data.id) ? data : c));
        await fetchConsultants();
        toast({ type: "success", message: "کارشناس با موفقیت ویرایش شد." });
        return { ok: true, data };
      } catch (error: any) {
        const message = error?.message || "خطا در ویرایش کارشناس";
        setConsultantFormError(message);
        return { ok: false, error: message };
      } finally {
        setConsultantFormSubmitting(false);
      }
    },
    [initialData.csrfToken, fetchConsultants]
  );

  const openPropertyDetail = useCallback((id: string) => {
    navigate("property-detail", id);
  }, [navigate]);

  const openPropertyEdit = useCallback((id: string) => {
    navigate("edit-property", id);
  }, [navigate]);

  const fetchProperties = useCallback(async () => {
    setPropertiesLoading(true);
    setPropertiesError(null);
    try {
      const res = await apiFetch(
        "/properties/api/properties/options/",
        { method: "GET", cache: "no-store" },
        initialData.csrfToken
      );
      if (!res.ok) throw new Error("خطا در دریافت لیست املاک");
      const all: Property[] = await res.json();
      setProperties(all);
      return all;
    } catch (error: any) {
      setPropertiesError(error.message || "خطا در بارگذاری");
      return [];
    } finally {
      setPropertiesLoading(false);
    }
  }, [initialData.csrfToken]);

  useEffect(() => {
    const needsVisibleProperties = new Set([
      "admin-dashboard",
      "properties",
      "add-property",
      "edit-property",
      "property-files",
      "my-property-files",
      "create-property-file",
      "edit-property-file",
      "tasks-kanban",
      "create-task",
      "tasks-calendar",
      "follow-ups",
      "my-followups",
      "create-followup",
      "edit-followup",
    ]);
    if (!needsVisibleProperties.has(page)) return;
    fetchProperties();
  }, [page, fetchProperties]);

  useEffect(() => {
    const wantedId = page === "edit-property"
      ? (editingPropertyId || selectedPropertyId)
      : selectedPropertyId;
    if ((page !== "property-detail" && page !== "edit-property") || !wantedId) return;

    const controller = new AbortController();
    setPropertyDetailLoading(true);
    setPropertyDetailError(null);
    setSelectedProperty((current) =>
      current && String(current.id) === String(wantedId) ? current : undefined
    );

    async function loadDetail() {
      try {
        const res = await apiFetch(
          `/properties/api/properties/${wantedId}/`,
          { method: "GET", signal: controller.signal, cache: "no-store" },
          initialData.csrfToken
        );
        const data = await readJson(res);
        if (!res.ok) throw new Error(apiErrorMessage(data, "خطا در دریافت جزئیات ملک"));
        setSelectedProperty(data);
      } catch (error: any) {
        if (!controller.signal.aborted) {
          setSelectedProperty(undefined);
          setPropertyDetailError(error?.message || "خطا در دریافت جزئیات ملک");
        }
      } finally {
        if (!controller.signal.aborted) setPropertyDetailLoading(false);
      }
    }

    void loadDetail();
    return () => controller.abort();
  }, [page, selectedPropertyId, editingPropertyId, initialData.csrfToken]);

  const submitProperty = useCallback(
    async (payload: Record<string, any>, propertyId?: string | null) => {
      try {
        setPropertyFormSubmitting(true);
        setPropertyFormError(null);

        const isEdit = Boolean(propertyId);
        const isDraftCreation = !isEdit && payload.status === "DRAFT";
        const url = isEdit
          ? `/properties/api/properties/${propertyId}/`
          : isDraftCreation
            ? "/properties/api/properties/draft/"
            : "/properties/api/properties/";
        const method = isEdit ? "PATCH" : "POST";

        const res = await apiFetch(url, { method, body: JSON.stringify(payload) }, initialData.csrfToken);

        const data = await readJson(res);

        if (!res.ok) {
          throw new Error(apiErrorMessage(data, "خطا در ثبت ملک"));
        }

        setSelectedProperty(data);
        setSelectedPropertyId(String(data.id));
        setEditingPropertyId(null);

        setProperties((prev) => {
          const exists = prev.some((p) => String(p.id) === String(data.id));
          if (exists) {
            return prev.map((p) => (String(p.id) === String(data.id) ? data : p));
          }
          return [data, ...prev];
        });

        return { ok: true, data };
      } catch (error: any) {
        const message = error?.message || "خطا در ثبت اطلاعات ملک";
        setPropertyFormError(message);
        return { ok: false, error: message };
      } finally {
        setPropertyFormSubmitting(false);
      }
    },
    [initialData.csrfToken]
  );

  const uploadPropertyImages = useCallback(
    async (propertyId: string, files: File[]) => {
      if (!files.length) {
        return { ok: true, data: [] };
      }

      const uploadedImages: any[] = [];
      for (let offset = 0; offset < files.length; offset += 10) {
        const formData = new FormData();
        files.slice(offset, offset + 10).forEach((file) => {
          formData.append("images", file);
        });

        const res = await apiFetch(
          `/properties/api/properties/${propertyId}/images/`,
          { method: "POST", body: formData },
          initialData.csrfToken
        );
        const data = await readJson(res);
        if (!res.ok) {
          const error: any = new Error(apiErrorMessage(data, "خطا در آپلود تصاویر"));
          error.uploadedImages = uploadedImages;
          throw error;
        }
        if (Array.isArray(data)) uploadedImages.push(...data);
      }

      return { ok: true, data: uploadedImages };
    },
    [initialData.csrfToken]
  );

  const deletePropertyImage = useCallback(
    async (propertyId: string, imageId: string) => {
      const res = await apiFetch(
        `/properties/api/properties/${propertyId}/images/${imageId}/`,
        { method: "DELETE" },
        initialData.csrfToken
      );
      if (!res.ok && res.status !== 204) {
        const data = await readJson(res);
        throw new Error(apiErrorMessage(data, "خطا در حذف تصویر"));
      }
      setSelectedProperty((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          images: (prev.images || []).filter((img: any) => String(img.id) !== String(imageId)),
        };
      });
    },
    [initialData.csrfToken]
  );

  const reorderPropertyImages = useCallback(
    async (propertyId: string, order: { id: string | number; sort_order: number }[]) => {
      const res = await apiFetch(
        `/properties/api/properties/${propertyId}/images-reorder/`,
        { method: "PATCH", body: JSON.stringify(order) },
        initialData.csrfToken
      );
      const data = await readJson(res);
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, "خطا در تغییر ترتیب تصاویر"));
      }
      if (Array.isArray(data)) {
        setSelectedProperty((prev) => {
          if (!prev) return prev;
          return { ...prev, images: data };
        });
      }
    },
    [initialData.csrfToken]
  );

  const uploadAppraisalReport = useCallback(
    async (propertyId: string, file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const res = await apiFetch(
        `/properties/api/properties/${propertyId}/appraisal-report/`,
        { method: "POST", body: formData },
        initialData.csrfToken
      );

      const data = await readJson(res);

      if (!res.ok) {
        throw new Error(apiErrorMessage(data, "خطا در بارگذاری گزارش کارشناسی"));
      }

      setSelectedProperty((prev) =>
        prev && String(prev.id) === String(propertyId)
          ? { ...prev, appraisalReport: data }
          : prev
      );
      return { ok: true, data };
    },
    [initialData.csrfToken]
  );

  const deleteAppraisalReport = useCallback(
    async (propertyId: string) => {
      const res = await apiFetch(
        `/properties/api/properties/${propertyId}/appraisal-report/`,
        { method: "DELETE" },
        initialData.csrfToken
      );
      if (!res.ok && res.status !== 204) {
        const data = await readJson(res);
        throw new Error(apiErrorMessage(data, "خطا در حذف گزارش کارشناسی"));
      }
      setSelectedProperty((prev) =>
        prev && String(prev.id) === String(propertyId)
          ? { ...prev, appraisalReport: null }
          : prev
      );
    },
    [initialData.csrfToken]
  );

  const archiveProperty = useCallback(async (id: string) => {
    try {
      const res = await apiFetch(`/properties/api/properties/${id}/`, {
        method: "PATCH",
        body: JSON.stringify({ status: "INACTIVE" }),
      }, initialData.csrfToken);
      if (!res.ok) throw new Error("خطا در بایگانی ملک");
      toast({ type: "success", message: "ملک بایگانی شد." });
      await fetchProperties();
      navigate("properties");
    } catch (err: any) {
      toast({ type: "error", message: err?.message || "خطای ناشناخته" });
    }
  }, [initialData.csrfToken, fetchProperties, navigate]);

  const deleteProperty = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await apiFetch(`/properties/api/properties/${id}/`, { method: "DELETE" }, initialData.csrfToken);
      if (!res.ok) {
        const data = await readJson(res);
        throw new Error(apiErrorMessage(data, "خطا در حذف ملک"));
      }
      toast({ type: "success", message: "ملک حذف شد." });
      setProperties((prev) => prev.filter((p) => String(p.id) !== String(id)));
      await fetchProperties();
      navigate("properties");
      return true;
    } catch (err: any) {
      toast({ type: "error", message: err?.message || "خطای ناشناخته" });
      return false;
    }
  }, [initialData.csrfToken, fetchProperties, navigate]);

  const updatePropertyStatus = useCallback(async (id: string, status: string): Promise<boolean> => {
    try {
      const res = await apiFetch(`/properties/api/properties/${id}/`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }, initialData.csrfToken);
      const data = await readJson(res);
      if (!res.ok) throw new Error(apiErrorMessage(data, "خطا در تغییر وضعیت ملک"));

      setSelectedProperty(data);
      setProperties((prev) => prev.map((p) => (String(p.id) === String(id) ? data : p)));
      toast({ type: "success", message: "وضعیت ملک بروزرسانی شد." });
      return true;
    } catch (err: any) {
      toast({ type: "error", message: err?.message || "خطا در تغییر وضعیت ملک" });
      return false;
    }
  }, [initialData.csrfToken]);

  const reviewProperty = useCallback(async (id: string, action: "approve" | "reject", reason?: string): Promise<boolean> => {
    try {
      const payload = action === "reject" ? JSON.stringify({ reason }) : undefined;
      const res = await apiFetch(
        `/properties/api/properties/${id}/${action}/`,
        { method: "POST", ...(payload ? { body: payload } : {}) },
        initialData.csrfToken
      );
      const data = await readJson(res);
      if (!res.ok) throw new Error(apiErrorMessage(data, "بازبینی ملک انجام نشد."));
      setSelectedProperty(data);
      setProperties((previous) => previous.map((property) => String(property.id) === String(id) ? data : property));
      toast({
        type: "success",
        message: action === "approve" ? "ملک تأیید و منتشر شد." : "ملک برای اصلاح به کارشناس بازگردانده شد.",
      });
      return true;
    } catch (error: any) {
      toast({ type: "error", message: error?.message || "بازبینی ملک انجام نشد." });
      return false;
    }
  }, [initialData.csrfToken]);

  const submitConsultant = useCallback(
    async (payload: Record<string, any>) => {
      try {
        setConsultantFormSubmitting(true);
        setConsultantFormError(null);

        const hasImage = payload.profile_image instanceof File;

        if (hasImage) {
          const formData = new FormData();
          formData.append("first_name", payload.first_name || "");
          formData.append("last_name", payload.last_name || "");
          formData.append("username", payload.username || payload.email || "");
          formData.append("email", payload.email || "");
          formData.append("password", payload.password || "");
          formData.append("mobile", payload.mobile || "");
          formData.append("branch", payload.branch || "");
          formData.append("full_name", `${payload.first_name || ""} ${payload.last_name || ""}`.trim());
          formData.append("is_active", "true");
          formData.append("role", payload.role || "AGENT");
          formData.append("profile_image", payload.profile_image);

          const res = await apiFetch(
            "/accounts/consultants/",
            { method: "POST", body: formData },
            initialData.csrfToken
          );

          const data = await readJson(res).catch(() => null);

          if (!res.ok) {
            throw new Error(apiErrorMessage(data, "خطا در ثبت کارشناس"));
          }

          setConsultants((prev) => [data, ...prev]);
          await fetchConsultants();
          toast({ type: "success", message: "کارشناس با موفقیت ایجاد شد." });

          return { ok: true, data };
        } else {
          const normalizedPayload = {
            first_name: payload.first_name,
            last_name: payload.last_name,
            username: payload.username || payload.email || "",
            email: payload.email,
            password: payload.password,
            mobile: payload.mobile,
            branch: payload.branch,
            full_name: `${payload.first_name || ""} ${payload.last_name || ""}`.trim(),
            role: payload.role || "AGENT",
            is_active: true,
          };

          const res = await apiFetch("/accounts/consultants/", {
            method: "POST",
            body: JSON.stringify(normalizedPayload),
          }, initialData.csrfToken);

          const data = await res.json().catch(() => null);

          if (!res.ok) {
            const message = data && typeof data === "object"
              ? Object.values(data).flat().join(" / ")
              : "خطا در ثبت کارشناس";
            throw new Error(message);
          }

          setConsultants((prev) => [data, ...prev]);
          await fetchConsultants();
          toast({ type: "success", message: "کارشناس با موفقیت ایجاد شد." });

          return { ok: true, data };
        }
      } catch (error: any) {
        const message = error?.message || "خطا در ثبت کارشناس";
        setConsultantFormError(message);
        return { ok: false, error: message };
      } finally {
        setConsultantFormSubmitting(false);
      }
    },
    [initialData.csrfToken, fetchConsultants]
  );

  const fetchTasks = useCallback(async (filters?: { status?: string; dueDateFrom?: string; dueDateTo?: string }) => {
    setTasksLoading(true);
    setTasksError(null);
    try {
      const params = new URLSearchParams({ page_size: "1000" });
      if (role === "consultant") params.set("scope", "mine");
      if (filters?.status && filters.status !== "all") params.set("status", filters.status);
      if (filters?.dueDateFrom) params.set("dueDateFrom", filters.dueDateFrom);
      if (filters?.dueDateTo) params.set("dueDateTo", filters.dueDateTo);

      const allTasks: any[] = [];
      let pageNumber = 1;
      while (true) {
        params.set("page", String(pageNumber));
        const res = await apiFetch(`/tasks/api/tasks/?${params.toString()}`, { method: "GET" }, initialData.csrfToken);
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(apiErrorMessage(data, "خطا در دریافت وظایف"));
        }
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.results ?? []);
        allTasks.push(...items);
        if (Array.isArray(data) || !data.next || items.length === 0) break;
        pageNumber += 1;
      }
      setTasks(allTasks);
      return allTasks;
    } catch (err: any) {
      setTasksError(err?.message || "خطا در بارگذاری وظایف");
      return [];
    } finally {
      setTasksLoading(false);
    }
  }, [initialData.csrfToken, role, currentConsultantId]);

  const fetchTaskSummary = useCallback(async () => {
    try {
      const res = await apiFetch("/tasks/api/tasks/summary/", { method: "GET" }, initialData.csrfToken);
      if (res.ok) {
        const data = await res.json();
        setTaskSummary(data);
      }
    } catch (err) {
      console.error("Error fetching task summary:", err);
    }
  }, [initialData.csrfToken]);

  useEffect(() => {
    if (page !== "tasks-kanban" && page !== "create-task" && page !== "tasks-calendar" && page !== "my-tasks" && page !== "consultant-dashboard" && page !== "admin-dashboard") return;
    fetchTasks();
  }, [page, fetchTasks]);

  const createTask = useCallback(async (payload: Record<string, any>) => {
    const res = await apiFetch("/tasks/api/tasks/", { method: "POST", body: JSON.stringify(payload) }, initialData.csrfToken);
    const data = await readJson(res);
    if (!res.ok) {
      throw new Error(apiErrorMessage(data, "خطا در ایجاد وظیفه"));
    }
    setTasks((prev) => [data, ...prev]);
    bumpMyTasks();
    fetchTaskSummary();
    return data;
  }, [initialData.csrfToken, fetchTaskSummary, bumpMyTasks]);

  const updateTaskStatus = useCallback(async (id: string, status: string) => {
    const res = await apiFetch(`/tasks/api/tasks/${id}/`, { method: "PATCH", body: JSON.stringify({ status }) }, initialData.csrfToken);
    const data = await readJson(res);
    if (!res.ok) {
      throw new Error(apiErrorMessage(data, "خطا در تغییر وضعیت وظیفه"));
    }
    setTasks((prev) => prev.map((t) => String(t.id) === String(id) ? data : t));
    bumpMyTasks();
    fetchTaskSummary();
    return data;
  }, [initialData.csrfToken, fetchTaskSummary, bumpMyTasks]);

  const saveTask = useCallback(async (id: string, patch: Record<string, any>) => {
    const res = await apiFetch(`/tasks/api/tasks/${id}/`, { method: "PATCH", body: JSON.stringify(patch) }, initialData.csrfToken);
    const data = await readJson(res);
    if (!res.ok) {
      throw new Error(apiErrorMessage(data, "خطا در ذخیره وظیفه"));
    }
    setTasks((prev) => prev.map((t) => String(t.id) === String(id) ? data : t));
    bumpMyTasks();
    return data;
  }, [initialData.csrfToken, bumpMyTasks]);
  
  const deleteTask = useCallback(async (id: string) => {
    const res = await apiFetch(`/tasks/api/tasks/${id}/`, { method: "DELETE" }, initialData.csrfToken);
    if (!res.ok) {
      const data = await readJson(res);
      throw new Error(apiErrorMessage(data, "خطا در حذف وظیفه"));
    }
    setTasks((prev) => prev.filter((t) => String(t.id) !== String(id)));
    bumpMyTasks();
    fetchTaskSummary();
  }, [initialData.csrfToken, fetchTaskSummary, bumpMyTasks]);

  useEffect(() => {
    if (page === "admin-dashboard" || page === "consultant-dashboard") {
      refreshDashboard();
    }
  }, [page, refreshDashboard]);

  const upcomingFollowups = useMemo(() => {
    const activity = (f: FollowUp) =>
      new Date(f.updatedAt || f.createdAt || f.date || 0).getTime();

    return followups
      .filter((f) => f.status === "scheduled")
      .slice()
      .sort((a, b) => {
        const overdue = Number(isFollowUpOverdue(b)) - Number(isFollowUpOverdue(a));
        if (overdue !== 0) return overdue;

        const recency = activity(b) - activity(a);
        if (recency !== 0) return recency;

        return String(b.id).localeCompare(String(a.id));
      })
      .slice(0, 5);
  }, [followups]);

  const renderAdminDashboard = () => (
    <AdminDashboard kpis={dashboardKpis} navigate={navigate} onRefresh={refreshDashboard} topConsultants={topConsultants} recentActivities={recentActivities} tasks={tasks} upcomingFollowups={upcomingFollowups} revenueMonthly={revenueMonthly} revenueDealTypes={revenueDealTypes} propertyComposition={propertyComposition} hotProperties={hotProperties} located={locatedProperties} properties={properties} onSaveTask={saveTask} onDeleteTask={deleteTask} />
  );
  const renderConsultantDashboard = () => (
    <ConsultantDashboard
      navigate={navigate}
      tasks={tasks}
      followups={followups}
      userName={userName}
      consultantId={currentConsultantId}
      recentActivities={recentActivities}
      onSaveTask={saveTask}
      onDeleteTask={deleteTask}
      myReport={myReport}
      propertyComposition={propertyComposition}
      located={locatedProperties}
      kpis={{
        properties: dashboardKpis.totalProperties,
        propertyFiles: dashboardKpis.activePropertyFiles,
        openTasks: dashboardKpis.openTasks,
      }}
    />
  );

  const renderCrmPage = () => <CrmPages csrfToken={initialData.csrfToken} page={page} role={role} currentUserId={currentConsultantId} navigate={navigate} recordId={selectedCrmRecordId} />;

  const renderPage = () => {
    const pageRegistry: Partial<Record<Page, () => React.ReactNode>> = {
      "admin-dashboard": renderAdminDashboard,
      "consultant-dashboard": renderConsultantDashboard,
      "crm-dashboard": () => (role === "consultant" ? renderConsultantDashboard() : renderAdminDashboard()),
      "properties": () => {
        return (
          <PropertiesPage
            navigate={navigate}
            role={role}
            properties={properties}
            loading={propertiesLoading}
            openPropertyDetail={openPropertyDetail}
            openPropertyEdit={openPropertyEdit}
            onArchive={archiveProperty}
            onDelete={deleteProperty}
            consultants={consultants}
            districtsList={districtsList}
            csrfToken={initialData.csrfToken}
          />
        );
      },
      "property-detail": () => {
        if (!selectedProperty || String(selectedProperty.id) !== String(selectedPropertyId)) {
          return (
            <div className="flex min-h-full items-center justify-center p-8" role={propertyDetailError ? "alert" : "status"} aria-live="polite">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">{propertyDetailError || (propertyDetailLoading || selectedPropertyId ? "در حال دریافت اطلاعات ملک…" : "شناسه ملک معتبر نیست.")}</p>
                {propertyDetailError && <button type="button" onClick={() => navigate("properties")} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">بازگشت به املاک</button>}
              </div>
            </div>
          );
        }
return (
          <PropertyDetail
            key={String(selectedProperty.id)}
            navigate={navigate}
            role={role}
            property={selectedProperty}
            currentUserId={currentConsultantId}
            csrfToken={initialData.csrfToken}
            onArchive={archiveProperty}
            onDelete={deleteProperty}
            onUpdateStatus={updatePropertyStatus}
            onApprove={(id) => reviewProperty(id, "approve")}
            onReject={(id, reason) => reviewProperty(id, "reject", reason)}
            openPropertyEdit={openPropertyEdit}
            openPropertyReport={(id) => navigate("property-reports", id)}
            onDeleteImage={deletePropertyImage}
            onUploadImages={uploadPropertyImages}
            onReorderImages={reorderPropertyImages}
            onUploadAppraisalReport={uploadAppraisalReport}
            onDeleteAppraisalReport={deleteAppraisalReport}
          />
        );
      },
      "property-reports": () => {
        const pid = selectedPropertyIdForReport || selectedPropertyId;
const prop = (properties || []).find((p) => String(p.id) === String(pid)) || selectedProperty;
return (
          <PropertyReportsPage
            csrfToken={initialData.csrfToken}
            propertyId={pid ? String(pid) : null}
            propertyPreview={prop}
            onBack={() => {
              if (pid) navigate("property-detail", pid); else navigate("properties");
            }}
          />
        );
      },
      "edit-property": () => {
        const editTargetId = editingPropertyId || selectedPropertyId;
if (!selectedProperty || String(selectedProperty.id) !== String(editTargetId)) {
          return (
            <div className="flex min-h-full items-center justify-center p-8" role={propertyDetailError ? "alert" : "status"} aria-live="polite">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">{propertyDetailError || (propertyDetailLoading || selectedPropertyId ? "در حال دریافت اطلاعات ملک…" : "شناسه ملک معتبر نیست.")}</p>
                {propertyDetailError && <button type="button" onClick={() => navigate("properties")} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">بازگشت به املاک</button>}
              </div>
            </div>
          );
        }
return (
          <EditPropertyWizard
            navigate={(targetPage) => navigate(targetPage, targetPage === "property-detail" || targetPage === "edit-property" ? editTargetId ?? undefined : undefined)}
            role={role}
            property={selectedProperty}
            propertyId={editTargetId}
            onSubmit={submitProperty}
            isSubmitting={propertyFormSubmitting}
            submitError={propertyFormError}
            consultants={consultants}
            districtsList={districtsList}
            properties={properties}
            csrfToken={initialData.csrfToken}
          />
        );
      },
      "property-files": () => {
        return (
          <PropertyFilesPage
            navigate={navigate}
            initialTab={page === "property-files-explore" || page === "crm-explore" ? "explore" : "mine"}
            role={role}
            currentConsultantId={currentConsultantId}
            consultants={consultants}
            properties={properties}
            propertyFiles={propertyFiles}
            onAction={handlePropertyFileAction}
            loading={propertyFilesLoading}
          />
        );
      },
      "create-property-file": () => {
        return (
          <CreatePropertyFileWizard
            navigate={navigate}
            role={role}
            preselectedPropertyId={selectedPropertyId || undefined}
            currentConsultantId={currentConsultantId}
            currentConsultant={consultants.find(c => String(c.user?.id || c.id) === String(currentConsultantId))}
            consultants={consultants}
            properties={properties}
            onSubmit={submitPropertyFile}
            isSubmitting={propertyFileFormSubmitting}
            submitError={propertyFileFormError}
            csrfToken={initialData.csrfToken}
          />
        );
      },
      "edit-property-file": () => {
        if (!selectedPropertyFile || String(selectedPropertyFile.id) !== String(selectedPropertyFileId)) {
          return (
            <div className="flex min-h-full items-center justify-center p-8" role={propertyFileDetailError ? "alert" : "status"} aria-live="polite">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">{propertyFileDetailError || (propertyFileDetailLoading || selectedPropertyFileId ? "در حال دریافت اطلاعات فایل…" : "شناسه فایل معتبر نیست.")}</p>
                {propertyFileDetailError && <button type="button" onClick={() => navigate("property-files")} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">بازگشت به فایل‌ها</button>}
              </div>
            </div>
          );
        }
return (
          <CreatePropertyFileWizard
            key={`edit-propertyFile-${selectedPropertyFile.id}`}
            navigate={navigate}
            role={role}
            editingPropertyFile={selectedPropertyFile}
            currentConsultantId={currentConsultantId}
            currentConsultant={consultants.find(c => String(c.user?.id || c.id) === String(currentConsultantId))}
            consultants={consultants}
            properties={properties}
            onSubmit={submitPropertyFile}
            isSubmitting={propertyFileFormSubmitting}
            submitError={propertyFileFormError}
            csrfToken={initialData.csrfToken}
          />
        );
      },
      "property-file-detail": () => {
        if (!selectedPropertyFile || String(selectedPropertyFile.id) !== String(selectedPropertyFileId)) {
          return (
            <div className="flex min-h-full items-center justify-center p-8" role={propertyFileDetailError ? "alert" : "status"} aria-live="polite">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">{propertyFileDetailError || (propertyFileDetailLoading || selectedPropertyFileId ? "در حال دریافت جزئیات فایل…" : "شناسه فایل معتبر نیست.")}</p>
                {propertyFileDetailError && <button type="button" onClick={() => navigate("property-files")} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">بازگشت به فایل‌ها</button>}
              </div>
            </div>
          );
        }
return (
          <PropertyFileDetailPage
            navigate={(p, id) => navigate(p as Page, id)}
            role={role}
            propertyFile={selectedPropertyFile}
            onAction={handlePropertyFileAction}
          />
        );
      },
      "consultants": () => {
        return (
          <ConsultantsPage
            navigate={navigate}
            consultants={consultants}
            loading={consultantsLoading}
            error={consultantsError}
            onToggleActive={toggleConsultantActive}
            onDelete={deleteConsultant}
            onEdit={editConsultant}
            csrfToken={initialData.csrfToken}
            initialConsultantId={selectedConsultantId}
          />
        );
      },
      "add-consultant": () => {
        return (
          <AddConsultantPage
            navigate={navigate}
            onSubmit={submitConsultant}
            isSubmitting={consultantFormSubmitting}
            submitError={consultantFormError}
            districtsList={districtsList}
            role={role}
          />
        );
      },
      "edit-consultant": () => {
        return (
          <EditConsultantPage
            navigate={navigate}
            consultant={consultants.find((c) => String(c.id) === String(selectedConsultantId))}
            onSubmit={submitConsultantUpdate}
            isSubmitting={consultantFormSubmitting}
            submitError={consultantFormError}
            districtsList={districtsList}
            role={role}
          />
        );
      },
      "follow-ups": () => {
        return (
          <FollowUpsPage
            key={page}
            navigate={navigate}
            followups={followups}
            onArchive={archiveFollowup}
            onDelete={deleteFollowup}
            onComplete={completeFollowup}
            onEdit={editFollowup}
            onLoad={loadFollowups}
            refreshKey={followupsRefreshKey}
            currentUserId={currentConsultantId}
            page={page}
            role={role}
            consultants={consultants}
            properties={properties}
          />
        );
      },
      "create-followup": () => {
        return (
          <CreateFollowUp
            navigate={navigate}
            role={role}
            onSubmit={submitFollowup}
            isSubmitting={followupsLoading}
            submitError={followupsError}
            currentUserId={currentConsultantId}
            consultants={consultants}
            properties={properties}
            userName={userName}
          />
        );
      },
      "edit-followup": () => {
        const editing = selectedFollowup && String(selectedFollowup.id) === String(selectedFollowupId)
          ? selectedFollowup
          : undefined;
if (!editing) {
          return <div className="p-6 text-sm text-muted-foreground">در حال بارگذاری پیگیری…</div>;
        }
return (
          <CreateFollowUp
            navigate={navigate}
            role={role}
            onSubmit={submitFollowup}
            isSubmitting={followupsLoading}
            submitError={followupsError}
            currentUserId={currentConsultantId}
            consultants={consultants}
            properties={properties}
            userName={userName}
            editingFollowup={editing}
          />
        );
      },
      "tickets-sent": () => {
        return (
          <TicketsPage
            page={page}
            role={role}
            navigate={navigate}
            csrfToken={initialData.csrfToken}
            currentUserId={currentConsultantId}
            initialTicketId={selectedTicketId}
            onUnreadChanged={fetchTicketUnreadCount}
          />
        );
      },
      "crm-inbox": renderCrmPage,
      "activity": () => {
        return <NotificationsRecordsPage csrfToken={initialData.csrfToken} />;
      },
      "manage-attributes": () => {
        return <AttributesPage csrfToken={initialData.csrfToken} />;
      },
      "manage-districts": () => {
        return <DistrictsPage csrfToken={initialData.csrfToken} onDistrictsChanged={() => {
        apiFetch("/common/api/districts/", { method: "GET" }, initialData.csrfToken)
          .then(res => res.ok ? res.json() : [])
          .then(data => setDistrictsList(data))
          .catch(() => {});
      }} />;
      },
      "settings-workspace": () => {
        return <SettingsPage page={page} navigate={navigate} role={role} csrfToken={initialData.csrfToken} />;
      },
      "my-properties": () => {
        return (
          <MyPropertiesPage
            navigate={navigate}
            consultants={consultants}
            consultantId={currentConsultantId}
            openPropertyDetail={openPropertyDetail}
            openPropertyEdit={openPropertyEdit}
            onArchive={archiveProperty}
            csrfToken={initialData.csrfToken}
            userName={userName}
          />
        );
      },
      "all-properties": () => {
        return (
          <MyPropertiesPage
            navigate={navigate}
            consultants={consultants}
            consultantId={currentConsultantId}
            openPropertyDetail={openPropertyDetail}
            openPropertyEdit={openPropertyEdit}
            onArchive={archiveProperty}
            csrfToken={initialData.csrfToken}
            userName={userName}
          />
        );
      },
      "my-tasks": () => {
        return (
          <TasksWorkspacePage
            page={page}
            list={{
              tasks,
              consultantId: currentConsultantId,
              role,
              onLoad: fetchTasks,
              refreshKey: myTasksRefreshKey,
              onSave: saveTask,
              onStatusChange: updateTaskStatus,
              onDelete: deleteTask,
            }}
            board={{
              key: page,
              tasks,
              loading: tasksLoading,
              consultants,
              properties,
              onCreate: createTask,
              onStatusChange: updateTaskStatus,
              onSave: saveTask,
              onDelete: deleteTask,
              currentUserId: currentConsultantId,
              role,
              taskTypesList,
              initialCreateOpen: page === "create-task",
              onCreateDismiss: page === "create-task" ? () => navigate("my-tasks") : undefined,
            }}
            calendar={{ tasks }}
          />
        );
      },
      "my-profile": () => {
        return <MyProfilePage page={page} navigate={navigate} userName={userName} role={role} csrfToken={initialData.csrfToken} onProfileUpdated={(newName) => { setUserName(newName); if (role === "admin") { fetchAdminProfile(); } }} districtsList={districtsList} />;
      }
    };
    pageRegistry["my-property-files"] = pageRegistry["property-files"];
    pageRegistry["property-files-explore"] = pageRegistry["property-files"];
    pageRegistry["crm-explore"] = pageRegistry["property-files"];
    pageRegistry["guide"] = pageRegistry["settings-workspace"];
    pageRegistry["tasks-kanban"] = pageRegistry["my-tasks"];
    pageRegistry["tasks-calendar"] = pageRegistry["my-tasks"];
    pageRegistry["create-task"] = pageRegistry["my-tasks"];
    pageRegistry["my-followups"] = pageRegistry["follow-ups"];
    pageRegistry["tickets-received"] = pageRegistry["tickets-sent"];
    pageRegistry["tickets-all"] = pageRegistry["tickets-sent"];
    pageRegistry["create-ticket"] = pageRegistry["tickets-sent"];
    pageRegistry["crm-property-register"] = pageRegistry["crm-inbox"];
    pageRegistry["add-property"] = pageRegistry["crm-inbox"];
    pageRegistry["crm-property-cases"] = pageRegistry["crm-inbox"];
    pageRegistry["crm-reviews"] = pageRegistry["crm-inbox"];
    pageRegistry["crm-inquiries"] = pageRegistry["crm-inbox"];
    pageRegistry["crm-inquiry-register"] = pageRegistry["crm-inbox"];
    pageRegistry["crm-introductions"] = pageRegistry["crm-inbox"];
    pageRegistry["crm-viewings"] = pageRegistry["crm-inbox"];
    pageRegistry["crm-contacts"] = pageRegistry["crm-inbox"];
    pageRegistry["crm-pipelines"] = pageRegistry["crm-inbox"];
    pageRegistry["crm-deals"] = pageRegistry["crm-inbox"];
    pageRegistry["crm-contracts"] = pageRegistry["crm-inbox"];
    pageRegistry["crm-finance"] = pageRegistry["crm-inbox"];
    pageRegistry["crm-reports"] = pageRegistry["crm-inbox"];
    pageRegistry["settings-permissions"] = pageRegistry["settings-workspace"];
    pageRegistry["settings-ranges"] = pageRegistry["settings-workspace"];
    pageRegistry["settings-login-options"] = pageRegistry["settings-workspace"];
    pageRegistry["crm-settings"] = pageRegistry["settings-workspace"];
    pageRegistry["crm-deal-types"] = pageRegistry["settings-workspace"];
    pageRegistry["my-profile-edit"] = pageRegistry["my-profile"];
    pageRegistry["my-profile-security"] = pageRegistry["my-profile"];
    const renderer = pageRegistry[page];
    return renderer ? renderer() : <div className="p-6"><EmptyState title="صفحه پیدا نشد" description="از منوی اصلی یک بخش معتبر را انتخاب کنید." /></div>;
  };

  const handleLogout = () => {
    setLogoutConfirm(false);

    beginIntentionalLogout();

    void (async () => {
      const logoutUrl = initialData.logoutUrl || "/accounts/logout/";
      const loginUrl = initialData.loginUrl || "/accounts/login/";

      try {
        try {
          await fetch(loginUrl, {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          });
        } catch {
        }

        const res = await apiFetch(logoutUrl, { method: "POST" });

        if (!res.ok) {
          toast({
            type: "error",
            message: "خروج از حساب ممکن نشد. صفحه برای به‌روزرسانی نشست بازنشانی می‌شود.",
          });
          window.location.reload();
          return;
        }

        window.location.assign(loginUrl);
      } catch {
        window.location.reload();
      }
    })();
  };

  const currentUserImageUrl = role === "admin"
    ? (adminProfile?.profile_image ?? null)
    : consultants.find((c) => String(c.user?.id || c.id) === String(currentConsultantId))?.profile_image;

  if (!initialData.isAuthenticated) {
    return (
      <>
        <React.Suspense fallback={<div className="p-6 text-sm text-muted-foreground">در حال بارگذاری صفحه ورود…</div>}>
          <LoginPage initialData={initialData} navigate={navigate} />
        </React.Suspense>
        <ToastContainer />
      </>
    );
  }

  return (
    <PermissionProvider permissions={permissions}>
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="hidden md:flex h-full">
        <Sidebar userId={initialData.currentConsultantId || undefined} role={role} page={page} navigate={navigate} collapsed={collapsed} setCollapsed={setCollapsed} userName={userName} userImageUrl={currentUserImageUrl} ticketUnreadCount={ticketUnreadCount} pendingReviewCount={pendingReviewCount} onLogout={() => setLogoutConfirm(true)} />
      </div>
      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNavOpen(false)} />
          <div className="relative z-10 flex h-full shadow-xl" role="dialog" aria-modal="true" aria-label="منوی اصلی">
            <Sidebar userId={initialData.currentConsultantId || undefined} role={role} page={page} navigate={(target, id) => { setMobileNavOpen(false); navigate(target, id); }} collapsed={false} setCollapsed={() => undefined} userName={userName} userImageUrl={currentUserImageUrl} ticketUnreadCount={ticketUnreadCount} pendingReviewCount={pendingReviewCount} onLogout={() => { setMobileNavOpen(false); setLogoutConfirm(true); }} />
          </div>
        </div>
      ) : null}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar userName={userName} userImageUrl={currentUserImageUrl} role={role} onCmd={() => setCmdOpen(true)} onNotif={() => setNotifOpen((p) => !p)} onMenu={() => setMobileNavOpen(true)} notifOpen={notifOpen} unreadCount={unreadCount} />
        <main className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          <React.Suspense fallback={<div className="p-6 text-sm text-muted-foreground">در حال بارگذاری بخش…</div>}>
            {renderPage()}
          </React.Suspense>
        </main>
      </div>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} navigate={navigate} role={role} permissions={permissions} />
      <NotifDrawer open={notifOpen} onClose={() => setNotifOpen(false)} notifications={notifications} csrfToken={initialData.csrfToken} onOpenTicket={(id, folder) => navigate(folder === "sent" ? "tickets-sent" : "tickets-received", id)} onOpenProperty={(id) => navigate("property-detail", id)} onOpenPropertyFile={(id) => navigate("property-file-detail", id)} />
      <ConfirmModal open={logoutConfirm} title="خروج از حساب؟" message="به صفحه ورود بازگردانده می‌شوید." onConfirm={handleLogout} onCancel={() => setLogoutConfirm(false)} />
      <ToastContainer />
    </div>
    </PermissionProvider>
  );
}
