import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FolderSearch,
  GripVertical,
  Image as ImageIcon,
  Lock,
  MapPin,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "../../../shared/components/ui/Badge";
import { EmptyState } from "../../../shared/components/ui/EmptyState";
import { LocationSelect, findLocationPath, useLocationTree } from "../../../shared/components/ui/LocationSelect";
import { ContactCombobox, type ContactComboboxRow } from "../../../shared/components/ui/ContactCombobox";
import { ConsultantCombobox } from "../../../shared/components/ui/ConsultantCombobox";
import { DynamicAttributeFields } from "../../../shared/components/ui/DynamicAttributeFields";
import { JalaliDateTimeInput } from "../../../shared/components/ui/JalaliDateTimeInput";
import { PropertyMapPicker } from "../../../shared/components/ui/PropertyMapPicker";
import { apiErrorMessage, apiFetch, readJson } from "../../../shared/lib/apiClient";
import { useAttributeSchema, useBasicsCatalog } from "../../../shared/lib/useAttributeSchema";
import type { Role } from "../../../shared/lib/types";
import { AccessibleModal } from "../components/AccessibleModal";
import { Btn, Card, Field, SearchBar, Shell, inputCls } from "../components/CrmUIKit";
import { patch, post } from "../lib/crmApi";
import { buildAssignableStaffOptions, type AssignableStaffRow } from "../lib/staffDomain";
import { useLoad } from "../lib/useCrmLoad";
import {
  DEFAULT_LEAD_SOURCE,
  LEAD_SOURCE_OPTIONS,
  STAGE_LABELS_FA,
  WIZARD_STEPS,
  clearSupplyDraft,
  computeStallInfo,
  deriveWizardStage,
  emitSupplyCountersRefresh,
  formatFaAmount,
  formatFaInt,
  normalizeLeadSource,
  normalizePersianSearch,
  previewDealTypeChange,
  readSupplyDraft,
  stageGuidanceForRole,
  supplyStatusBadgeMeta,
  wizardStepIndex,
  writeSupplyDraft,
  type DealTermsSchema,
  type DealTypeCatalogItem,
  type DealTypeChangePreview,
  type PropertyCaseRecord,
  type PropertyPartyRow,
  type WizardStepKey,
} from "../lib/supplyDomain";
import type { CrmPageProps, Row } from "../types";

type AppraisalDraftState = {
  contactMode: "new" | "existing";
  existingContactId: string;
  contactFullName: string;
  contactPhone: string;
  leadSource: string;
  leadSummary: string;
  desiredDealTypes: number[];
  propertyTitle: string;
  districtId: string;
  provinceId: string;
  cityId: string;
  neighborhood: string;
  address: string;
  propertyType: string;
  propertyTypeRef: string;
  propertyUsageId: string;
  latitude: string;
  longitude: string;
  attributes: Record<string, unknown>;
  area: string;
  reportText: string;
  visitNotes: string;
  documentStatus: string;
  isComplete: boolean;
  parties: PropertyPartyRow[];
};

const EMPTY_DRAFT: AppraisalDraftState = {
  contactMode: "new",
  existingContactId: "",
  contactFullName: "",
  contactPhone: "",
  leadSource: DEFAULT_LEAD_SOURCE,
  leadSummary: "",
  desiredDealTypes: [],
  propertyTitle: "",
  districtId: "",
  provinceId: "",
  cityId: "",
  neighborhood: "",
  address: "",
  propertyType: "APARTMENT",
  propertyTypeRef: "",
  propertyUsageId: "",
  latitude: "",
  longitude: "",
  attributes: {},
  area: "",
  reportText: "",
  visitNotes: "",
  documentStatus: "تک‌برگ",
  isComplete: true,
  parties: [{ fullName: "", phone: "", role: "OWNER", sharePercent: "100", isPrimary: true }],
};

type ExistingListingSummary = {
  id: number;
  title: string;
  status: string;
  deal_type: number | null;
  dealType?: number | null;
  dealTypeDisplay?: string;
  sale_price?: string | number | null;
  salePrice?: string | number | null;
  deposit?: string | number | null;
  monthly_rent?: string | number | null;
  monthlyRent?: string | number | null;
  terms?: Record<string, string | number | boolean>;
  version?: number;
};

function readInitialWizardUrlParams() {
  if (typeof window === "undefined") {
    return { caseId: "", chooseCase: false, reviewRequestId: "" };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    caseId: params.get("id") || params.get("case") || params.get("reviewRequest") || "",
    chooseCase: params.get("chooseCase") === "1",
    reviewRequestId: params.get("reviewRequest") || "",
  };
}

function syncWizardUrlParams(caseId: string | number | null, opts?: { chooseCase?: boolean; reviewRequest?: string | number | null }) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  if (caseId) params.set("id", String(caseId));
  if (opts?.chooseCase) params.set("chooseCase", "1");
  if (opts?.reviewRequest) params.set("reviewRequest", String(opts.reviewRequest));
  const suffix = params.toString();
  window.history.replaceState({}, "", `/app/property-register/${suffix ? `?${suffix}` : ""}`);
}

export function PropertyRegisterPage({
  csrfToken,
  role,
  currentUserId,
  recordId,
  navigate,
  embedded,
}: CrmPageProps) {
  const typedRole = (role || "consultant") as Role;
  const isManager = typedRole === "admin" || typedRole === "range_manager";
  const userKey = `${typedRole}:${currentUserId || "self"}`;

  const urlInit = useMemo(() => readInitialWizardUrlParams(), []);
  const [selectedCaseId, setSelectedCaseId] = useState<string>(recordId || urlInit.caseId || "");
  const [pickerOpen, setPickerOpen] = useState<boolean>(urlInit.chooseCase);
  const [pickerSearch, setPickerSearch] = useState("");
  const [reviewSummaryOpen, setReviewSummaryOpen] = useState<boolean>(Boolean(urlInit.reviewRequestId));
  const [submittedReviewVersion, setSubmittedReviewVersion] = useState<number | null>(null);

  const [viewedStepOverride, setViewedStepOverride] = useState<WizardStepKey | null>(null);
  const [draft, setDraft] = useState<AppraisalDraftState>(EMPTY_DRAFT);
  const [restoredDraftAt, setRestoredDraftAt] = useState<string>("");
  const [gallery, setGallery] = useState<File[]>([]);
  const [galleryError, setGalleryError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageUploadKeys = useRef(new WeakMap<File, string>());
  const [galleryPreviews, setGalleryPreviews] = useState<Array<{ file: File; url: string }>>([]);
  const galleryPreviewUrls = useRef(new Map<File, string>());
  // Drag bookkeeping for the upload queue: which photo is being carried and which slot it is over.
  const [queueDragIndex, setQueueDragIndex] = useState<number | null>(null);
  const [queueDropIndex, setQueueDropIndex] = useState<number | null>(null);

  const [assigneeId, setAssigneeId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [reviewDecision, setReviewDecision] = useState<"APPROVED" | "CHANGES_REQUIRED">("APPROVED");
  const [reviewReason, setReviewReason] = useState("");

  const [selectedDealTypeId, setSelectedDealTypeId] = useState<string>("");
  const [pendingDealTypeId, setPendingDealTypeId] = useState<string>("");
  const [dealTypePreview, setDealTypePreview] = useState<DealTypeChangePreview | null>(null);
  const [listingTerms, setListingTerms] = useState<Record<string, string | number | boolean>>({});
  const [listingStatus, setListingStatus] = useState<"DRAFT" | "ACTIVE" | "PAUSED">("ACTIVE");
  const [listingDescription, setListingDescription] = useState("");

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { tree: locationTree, loading: locationLoading } = useLocationTree(csrfToken);
  const { catalog, loading: catalogLoading } = useBasicsCatalog(csrfToken);
  const { schema: propertySchema, loading: schemaLoading } = useAttributeSchema(
    "property",
    draft.propertyTypeRef,
    csrfToken,
  );
  const selectedPropertyType = catalog?.propertyTypes.find(
    (item) => String(item.id) === draft.propertyTypeRef,
  );
  const selectedLocationNames = useMemo(() => {
    const province = locationTree.find((item) => String(item.id) === draft.provinceId);
    const city = province?.cities.find((item) => String(item.id) === draft.cityId);
    const district = city?.districts.find((item) => String(item.id) === draft.districtId);
    return {
      provinceName: province?.displayName,
      cityName: city?.displayName,
      districtName: district?.displayName,
    };
  }, [locationTree, draft.provinceId, draft.cityId, draft.districtId]);
  const mapPoint = useMemo<[number, number] | null>(() => {
    if (!draft.latitude.trim() || !draft.longitude.trim()) return null;
    const latitude = Number(draft.latitude);
    const longitude = Number(draft.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
    return [latitude, longitude];
  }, [draft.latitude, draft.longitude]);

  // One object URL per queued photo, kept across re-renders: recreating them on every reorder made
  // the previews reload (and flicker) while a photo was being dragged.
  useEffect(() => {
    // Release the object URL of every photo that left the queue.
    for (const [file, url] of galleryPreviewUrls.current) {
      if (!gallery.includes(file)) {
        URL.revokeObjectURL(url);
        galleryPreviewUrls.current.delete(file);
      }
    }
    setGalleryPreviews(
      gallery.map((file) => {
        let url = galleryPreviewUrls.current.get(file);
        if (!url) {
          url = URL.createObjectURL(file);
          galleryPreviewUrls.current.set(file, url);
        }
        return { file, url };
      }),
    );
  }, [gallery]);

  useEffect(
    () => () => {
      for (const url of galleryPreviewUrls.current.values()) URL.revokeObjectURL(url);
      galleryPreviewUrls.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (!draft.propertyTypeRef && catalog?.propertyTypes.length) {
      const first = catalog.propertyTypes[0];
      setDraft((previous) => ({
        ...previous,
        propertyTypeRef: String(first.id),
        propertyUsageId: String(first.propertyUsage ?? ""),
      }));
    }
  }, [catalog, draft.propertyTypeRef]);

  useEffect(() => {
    if (selectedPropertyType?.propertyUsage != null) {
      setDraft((previous) =>
        previous.propertyUsageId === String(selectedPropertyType.propertyUsage)
          ? previous
          : { ...previous, propertyUsageId: String(selectedPropertyType.propertyUsage) },
      );
    }
  }, [selectedPropertyType]);

  useEffect(() => {
    if (recordId && recordId !== selectedCaseId) {
      setSelectedCaseId(recordId);
    }
  }, [recordId]);

  const caseDetailUrl = selectedCaseId ? `/crm/api/property-cases/${selectedCaseId}/` : "";
  const assignableStaffUrl = selectedCaseId ? `/crm/api/property-cases/${selectedCaseId}/assignable-staff/` : "";
  const baseUrls = [
    "/crm/api/property-cases/",
    "/crm/api/contacts/",
    "/crm/api/deal-types/",
    ...(caseDetailUrl ? [caseDetailUrl] : []),
    // Only a range manager (or a general manager) may read the candidate list, and only they see
    // the assignment form, so the request is scoped to them to keep the page error-free otherwise.
    ...(assignableStaffUrl && isManager ? [assignableStaffUrl] : []),
  ];
  const { data, error, loading, reload } = useLoad(baseUrls, csrfToken, [selectedCaseId, isManager]);

  const activeCase = caseDetailUrl ? ((data[caseDetailUrl] || null) as PropertyCaseRecord | null) : null;
  const allCases = (data["/crm/api/property-cases/"] || []) as PropertyCaseRecord[];
  const contacts = (data["/crm/api/contacts/"] || []) as Row[];
  const dealTypes = ((data["/crm/api/deal-types/"] || []) as DealTypeCatalogItem[]).filter(
    (dt) => dt.is_active && dt.published_version,
  );
  const assignableStaff = buildAssignableStaffOptions(
    (assignableStaffUrl ? data[assignableStaffUrl] : []) as AssignableStaffRow[] | undefined,
  );
  const staffLoading = loading && !assignableStaff.length;

  const propId = activeCase?.resulting_property ?? null;
  const propDetailUrl = propId ? `/properties/api/properties/${propId}/` : "";
  const propListingsUrl = propId ? `/crm/api/properties/${propId}/listings/` : "";
  const propLoad = useLoad(
    propId ? [propDetailUrl, propListingsUrl] : [],
    csrfToken,
    [propId, activeCase?.version],
  );
  const loadedProperty = propId ? (propLoad.data[propDetailUrl] as Row | undefined) : undefined;
  const existingImages = Array.isArray(loadedProperty?.images) ? loadedProperty.images as Array<{ id: number; url: string }> : [];
  const existingImageCount = existingImages.length;
  const propertyListings = (propId ? propLoad.data[propListingsUrl] || [] : []) as ExistingListingSummary[];

  const serverStep = deriveWizardStage(activeCase);
  const currentStep = viewedStepOverride || serverStep;
  const serverIndex = wizardStepIndex(serverStep);
  const currentIndex = wizardStepIndex(currentStep);
  const isViewingPast = currentIndex < serverIndex;
  const isViewingFuture = currentIndex > serverIndex;
  const guidance = stageGuidanceForRole(activeCase, typedRole, currentUserId);

  useEffect(() => {
    setViewedStepOverride(null);
    setGallery([]);
    setGalleryError("");
  }, [serverStep, selectedCaseId]);

  useEffect(() => {
    const saved = readSupplyDraft<AppraisalDraftState>(userKey, selectedCaseId || null);
    if (saved) {
      setDraft({
        ...EMPTY_DRAFT,
        ...saved.fields,
        leadSource: normalizeLeadSource((saved.fields as Partial<AppraisalDraftState>).leadSource),
        ...findLocationPath(locationTree, (saved.fields as Partial<AppraisalDraftState>).districtId),
      });
      setRestoredDraftAt(saved.savedAt);
      return;
    }
    setRestoredDraftAt("");
    if (activeCase) {
      const propParties = Array.isArray(loadedProperty?.parties) && loadedProperty.parties.length
        ? (loadedProperty.parties as PropertyPartyRow[])
        : [
            {
              fullName: activeCase.contact_name || "",
              phone: activeCase.contact_phones?.[0] || "",
              role: "OWNER" as const,
              sharePercent: "100",
              isPrimary: true,
            },
          ];
      setDraft({
        ...EMPTY_DRAFT,
        propertyTitle: activeCase.property_title || "",
        districtId: loadedProperty?.districtId ? String(loadedProperty.districtId) : "",
        ...findLocationPath(locationTree, loadedProperty?.districtId),
        neighborhood: String(loadedProperty?.neighborhood || ""),
        address: String(loadedProperty?.address || loadedProperty?.fullAddress || ""),
        propertyType: String(loadedProperty?.type || "APARTMENT"),
        propertyTypeRef: loadedProperty?.propertyTypeRef ? String(loadedProperty.propertyTypeRef) : "",
        propertyUsageId: loadedProperty?.propertyUsage ? String(loadedProperty.propertyUsage) : "",
        latitude: loadedProperty?.latitude != null ? String(loadedProperty.latitude) : "",
        longitude: loadedProperty?.longitude != null ? String(loadedProperty.longitude) : "",
        attributes: (loadedProperty?.attributes && typeof loadedProperty.attributes === "object"
          ? loadedProperty.attributes
          : {}) as Record<string, unknown>,
        area: loadedProperty?.area ? String(loadedProperty.area) : "",
        reportText: activeCase.appraisal?.report_text || "",
        visitNotes: activeCase.appraisal?.visit_notes || "",
        documentStatus: String(activeCase.appraisal?.findings?.document_status || "تک‌برگ"),
        isComplete: activeCase.appraisal?.is_complete ?? true,
        parties: propParties,
      });
    } else {
      setDraft(EMPTY_DRAFT);
    }
  }, [userKey, selectedCaseId, activeCase?.id, loadedProperty?.id, locationTree]);

  function updateDraft<K extends keyof AppraisalDraftState>(key: K, value: AppraisalDraftState[K]) {
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      writeSupplyDraft(
        userKey,
        selectedCaseId || null,
        next as unknown as Record<string, unknown>,
        activeCase?.version ?? null,
      );
      return next;
    });
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
    }
  }

  function updateAttribute(name: string, value: unknown) {
    updateDraft("attributes", { ...draft.attributes, [name]: value });
    setFieldErrors((previous) => {
      if (!(name in previous)) return previous;
      const next = { ...previous };
      delete next[name];
      return next;
    });
  }

  function addGalleryFiles(files: File[]) {
    setGalleryError("");
    const existingKeys = new Set(gallery.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    const accepted: File[] = [];
    const errors: string[] = [];
    for (const file of files) {
      const extOk = /\.(jpe?g|png|webp)$/i.test(file.name);
      const mimeOk = !file.type || ["image/jpeg", "image/png", "image/webp"].includes(file.type);
      if (!extOk || !mimeOk) {
        errors.push(`«${file.name}» فرمت مجاز ندارد.`);
      } else if (file.size > 5 * 1024 * 1024) {
        errors.push(`«${file.name}» بیش از ۵ مگابایت است.`);
      } else if (existingKeys.has(`${file.name}:${file.size}:${file.lastModified}`)) {
        errors.push(`«${file.name}» تکراری است.`);
      } else {
        existingKeys.add(`${file.name}:${file.size}:${file.lastModified}`);
        accepted.push(file);
      }
    }
    const remaining = Math.max(0, 30 - existingImageCount - gallery.length);
    if (accepted.length > remaining) errors.push(`برای این ملک حداکثر ${remaining} تصویر دیگر مجاز است.`);
    const clipped = accepted.slice(0, remaining);
    if (clipped.length) setGallery((previous) => [...previous, ...clipped]);
    if (errors.length) setGalleryError(errors.join(" "));
  }

  function moveGalleryItem(from: number, to: number) {
    if (from === to) return;
    // Both bounds are clamped so a drop outside the strip can never drop the photo.
    const target = Math.max(0, Math.min(to, gallery.length - 1));
    if (from < 0 || from >= gallery.length) return;
    setGallery((previous) => {
      const next = [...previous];
      const [moved] = next.splice(from, 1);
      next.splice(target, 0, moved);
      return next;
    });
  }

  function validateDynamicAttributes() {
    const errors: Record<string, string> = {};
    const fields = [...(propertySchema?.fields || []), ...(propertySchema?.facilities || [])];
    for (const field of fields) {
      if (field.isCore || !field.isRequired) continue;
      const value = draft.attributes[field.name];
      if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
        errors[field.name] = `تکمیل «${field.displayName}» الزامی است.`;
      }
    }
    return errors;
  }

  const currentDealType = useMemo(
    () => dealTypes.find((d) => String(d.id) === String(selectedDealTypeId)) || null,
    [dealTypes, selectedDealTypeId],
  );
  const currentSchema: DealTermsSchema | null = currentDealType?.published_version?.terms_schema || null;

  function handleDealTypeSelect(nextId: string) {
    if (!selectedDealTypeId || !nextId || nextId === selectedDealTypeId) {
      setSelectedDealTypeId(nextId);
      setDealTypePreview(null);
      return;
    }
    const nextDeal = dealTypes.find((d) => String(d.id) === String(nextId));
    const preview = previewDealTypeChange(
      currentSchema,
      nextDeal?.published_version?.terms_schema || null,
      listingTerms,
    );
    if (preview.incompatibleFields.length > 0) {
      setPendingDealTypeId(nextId);
      setDealTypePreview(preview);
      return;
    }
    setSelectedDealTypeId(nextId);
    setListingTerms(preview.preservedTerms);
    setDealTypePreview(null);
  }

  function confirmDealTypeSwitch() {
    if (!pendingDealTypeId || !dealTypePreview) return;
    setSelectedDealTypeId(pendingDealTypeId);
    setListingTerms(dealTypePreview.preservedTerms);
    setPendingDealTypeId("");
    setDealTypePreview(null);
  }

  const pickerFilteredCases = useMemo(() => {
    const q = normalizePersianSearch(pickerSearch);
    if (!q) return allCases;
    return allCases.filter((item) =>
      normalizePersianSearch(
        `${item.code} ${item.contact_name || ""} ${item.property_title || ""} ${item.description || ""} ${item.scope_name || ""}`,
      ).includes(q),
    );
  }, [allCases, pickerSearch]);

  async function handleCreateLead(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setFeedback("");
    const errs: Record<string, string> = {};
    if (draft.contactMode === "existing") {
      if (!draft.existingContactId) errs.existingContactId = "یک شخص موجود از فهرست انتخاب کنید.";
    } else {
      if (!draft.contactFullName.trim()) errs.contactFullName = "نام کامل مالک یا متقاضی ثبت الزامی است.";
      if (!draft.contactPhone.trim()) errs.contactPhone = "ثبت حداقل یک شماره تماس معتبر الزامی است.";
    }
    if (!draft.leadSummary.trim()) errs.leadSummary = "خلاصهٔ اولیهٔ ملک را وارد کنید.";
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }

    setBusy(true);
    try {
      const payload: Row = {
        lead_source: normalizeLeadSource(draft.leadSource),
        description: draft.leadSummary.trim(),
        desired_deal_type_ids: draft.desiredDealTypes,
      };
      if (draft.contactMode === "existing") {
        payload.contact = Number(draft.existingContactId);
      } else {
        payload.contact_full_name = draft.contactFullName.trim();
        payload.contact_phone = draft.contactPhone.trim();
      }
      const created = (await post(csrfToken, "/crm/api/property-cases/", payload)) as PropertyCaseRecord;
      clearSupplyDraft(userKey, null);
      setSelectedCaseId(String(created.id));
      syncWizardUrlParams(created.id);
      emitSupplyCountersRefresh();
      setFeedback(`پرونده ${created.code} ایجاد شد و به مرحلهٔ «${STAGE_LABELS_FA[created.stage]}» وارد گردید.`);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "ثبت اولیهٔ پرونده ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveAppraisal(submitAfterSave: boolean) {
    if (!activeCase) return;
    setFormError("");
    setFeedback("");
    const errs: Record<string, string> = {};
    if (submitAfterSave) {
      if (!draft.address.trim()) errs.address = "نشانی دقیق ملک الزامی است.";
      if (!draft.provinceId) errs.provinceId = "انتخاب استان الزامی است.";
      if (!draft.cityId) errs.cityId = "انتخاب شهر الزامی است.";
      if (!draft.districtId) errs.districtId = "انتخاب محله الزامی است.";
      if (catalog?.propertyTypes.length && !draft.propertyTypeRef) errs.propertyTypeRef = "انتخاب نوع مرجع ملک الزامی است.";
      if (!draft.area || Number(draft.area) <= 0) errs.area = "متراژ ملک باید عددی بزرگ‌تر از صفر باشد.";
      if (!draft.reportText.trim()) errs.reportText = "متن گزارش کارشناسی الزامی است.";
      if (schemaLoading) errs.attributes = "لطفاً تا بارگذاری ویژگی‌های نوع ملک صبر کنید.";
      Object.assign(errs, validateDynamicAttributes());
    }
    const hasLatitude = draft.latitude.trim() !== "";
    const hasLongitude = draft.longitude.trim() !== "";
    if (hasLatitude !== hasLongitude) {
      errs.latitude = "برای ثبت موقعیت، هر دو مختصات عرض و طول را وارد کنید.";
    } else if (hasLatitude && hasLongitude) {
      const latitude = Number(draft.latitude);
      const longitude = Number(draft.longitude);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) errs.latitude = "عرض جغرافیایی معتبر نیست.";
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) errs.longitude = "طول جغرافیایی معتبر نیست.";
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setGalleryError("");

    setBusy(true);
    try {
      const validParties = draft.parties
        .filter((p) => p.fullName.trim())
        .map((p) => ({
          full_name: p.fullName.trim(),
          phone: p.phone.trim(),
          role: p.role,
          share_percent: p.sharePercent ? Number(p.sharePercent) : null,
          is_primary: Boolean(p.isPrimary),
        }));
      const workspaceBody: Row = {
        address: draft.address.trim(),
        neighborhood: draft.neighborhood.trim(),
        district: draft.districtId ? Number(draft.districtId) : null,
        property_type: draft.propertyType,
        property_type_ref: draft.propertyTypeRef ? Number(draft.propertyTypeRef) : null,
        property_usage: draft.propertyUsageId ? Number(draft.propertyUsageId) : null,
        latitude: draft.latitude.trim() ? Number(draft.latitude) : null,
        longitude: draft.longitude.trim() ? Number(draft.longitude) : null,
        attributes: draft.attributes,
        area: draft.area ? Number(draft.area) : 0,
        report_text: draft.reportText.trim(),
        visit_notes: draft.visitNotes.trim(),
        findings: { document_status: draft.documentStatus },
        is_complete: submitAfterSave ? true : draft.isComplete,
        parties: validParties,
        version: activeCase.version,
      };
      if (isManager && draft.propertyTitle.trim()) {
        workspaceBody.property_title = draft.propertyTitle.trim();
      }
      const saved = (await post(
        csrfToken,
        `/crm/api/property-cases/${activeCase.id}/save_workspace/`,
        workspaceBody,
      )) as PropertyCaseRecord;

      if (gallery.length > 0) {
        const propertyId = String(saved.property_id ?? saved.resulting_property ?? "");
        if (!propertyId) {
          setFormError("ملک ذخیره شد اما شناسهٔ آن برای بارگذاری تصویر دریافت نشد؛ پرونده برای بررسی ارسال نشد.");
          reload();
          return;
        }
        for (const file of [...gallery]) {
          const formData = new FormData();
          formData.append("images", file);
          let idempotencyKey = imageUploadKeys.current.get(file);
          if (!idempotencyKey) {
            idempotencyKey = typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2)}`;
            imageUploadKeys.current.set(file, idempotencyKey);
          }
          try {
            const response = await apiFetch(
              `/properties/api/properties/${propertyId}/images/`,
              { method: "POST", body: formData, headers: { "Idempotency-Key": idempotencyKey } },
              csrfToken,
            );
            const responseData = await readJson(response);
            if (!response.ok) throw new Error(apiErrorMessage(responseData, "بارگذاری تصویر ناموفق بود."));
            setGallery((previous) => previous.filter((queued) => queued !== file));
          } catch (err) {
            setGalleryError(err instanceof Error ? err.message : "بارگذاری تصاویر کامل نشد.");
            setFeedback("اطلاعات کارشناسی ذخیره شد، اما همهٔ تصاویر بارگذاری نشدند. تصویرهای باقی‌مانده را دوباره بارگذاری کنید؛ پرونده هنوز برای بررسی مدیر ارسال نشده است.");
            reload();
            propLoad.reload();
            return;
          }
        }
      }

      if (submitAfterSave) {
        const reviewResp = (await post(
          csrfToken,
          `/crm/api/property-cases/${activeCase.id}/submit_property_for_review/`,
          { version: saved.version },
        )) as { version?: number };
        clearSupplyDraft(userKey, activeCase.id);
        setSubmittedReviewVersion(reviewResp.version ?? null);
        setReviewSummaryOpen(true);
        syncWizardUrlParams(activeCase.id, { reviewRequest: activeCase.id });
        emitSupplyCountersRefresh();
        setFeedback("گزارش کارشناسی با موفقیت برای بررسی و تأیید مدیر رنج ارسال شد.");
      } else {
        setFeedback("اطلاعات ملک و گزارش کارشناسی ذخیره شد (بدون ایجاد فایل عرضه).");
      }
      reload();
      propLoad.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "ذخیرهٔ اطلاعات کارشناسی ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveListing(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!propId || !selectedDealTypeId) {
      setFormError("انتخاب نوع معامله الزامی است.");
      return;
    }
    setBusy(true);
    setFormError("");
    setFeedback("");
    try {
      await post(csrfToken, `/crm/api/properties/${propId}/listings/`, {
        deal_type: Number(selectedDealTypeId),
        terms: listingTerms,
        sale_price: listingTerms.sale_price ?? null,
        deposit: listingTerms.deposit ?? null,
        monthly_rent: listingTerms.monthly_rent ?? null,
        description: listingDescription.trim(),
        status: listingStatus,
      });
      setFeedback("فایل عرضه ذخیره شد و نسخهٔ شرایط معامله ثبت گردید.");
      propLoad.reload();
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "ذخیرهٔ فایل عرضه ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  if (typedRole === "finance") {
    return (
      <Shell title="ثبت و جریان تأمین ملک" embedded={embedded}>
        <Card className="py-10 text-center">
          <p className="text-sm font-bold text-foreground">عدم دسترسی به جریان عملیاتی تأمین ملک</p>
          <p className="mt-1 text-xs text-muted-foreground">نقش مالی مجاز به ایجاد پرونده یا کارشناسی ملک نیست.</p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell
      title="جریان یکپارچهٔ تأمین ملک"
      subtitle="از ثبت سرنخ تا پذیرش، کارشناسی، تأیید ملک و انتشار فایل عرضه در یک مسیر پیوسته"
      error={error}
      loading={loading}
      onReload={reload}
      embedded={embedded}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Btn
            type="button"
            color="light"
            onClick={() => {
              setPickerOpen(true);
              syncWizardUrlParams(selectedCaseId || null, { chooseCase: true });
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <FolderSearch size={14} />
              ادامهٔ پروندهٔ قبلی ({formatFaInt(allCases.length, "۰")})
            </span>
          </Btn>
          {selectedCaseId ? (
            <Btn
              type="button"
              color="light"
              onClick={() => {
                setSelectedCaseId("");
                setViewedStepOverride(null);
                syncWizardUrlParams(null);
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <Plus size={14} />
                شروع پروندهٔ جدید
              </span>
            </Btn>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {activeCase ? (
            <Btn type="button" color="light" onClick={() => navigate("crm-property-cases", activeCase.id)}>
              نمای کامل پرونده ({activeCase.code})
            </Btn>
          ) : null}
          <Btn type="button" color="light" onClick={() => navigate("crm-property-cases")}>
            فهرست پرونده‌ها
          </Btn>
        </div>
      </div>

      <nav aria-label="مراحل هفت‌گانه تأمین ملک" className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {WIZARD_STEPS.map((step) => {
          const isCompleted = step.index < serverIndex;
          const isServerCurrent = step.index === serverIndex;
          const isSelected = step.key === currentStep;
          return (
            <button
              key={step.key}
              type="button"
              aria-current={isSelected ? "step" : undefined}
              onClick={() => setViewedStepOverride(step.key === serverStep ? null : step.key)}
              className={`flex flex-col items-start rounded-2xl border p-3 text-right transition-colors ${
                isSelected
                  ? "border-primary bg-primary/10 text-foreground"
                  : isCompleted
                    ? "border-emerald-500/40 bg-emerald-500/5 text-foreground hover:bg-emerald-500/10"
                    : "border-border bg-card text-muted-foreground hover:bg-secondary"
              }`}
            >
              <div className="flex w-full items-center justify-between text-xs font-bold">
                <span>مرحله {(step.index + 1).toLocaleString("fa-IR")}</span>
                {isCompleted ? (
                  <Check size={13} className="text-emerald-600 dark:text-emerald-400" />
                ) : isServerCurrent ? (
                  <span className="h-2 w-2 rounded-full bg-primary" />
                ) : (
                  <Lock size={12} className="text-muted-foreground/70" />
                )}
              </div>
              <strong className="mt-1 text-xs font-bold text-foreground">{step.label}</strong>
              <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{step.shortDesc}</span>
            </button>
          );
        })}
      </nav>

      <div className="mb-5 rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="text-xs font-bold text-primary">الان چه کاری انجام بدهم؟</span>
            <h2 className="mt-0.5 text-sm font-bold text-foreground">{guidance.headline}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{guidance.body}</p>
          </div>
          {viewedStepOverride ? (
            <Btn type="button" color="light" onClick={() => setViewedStepOverride(null)}>
              بازگشت به مرحلهٔ جاری ({WIZARD_STEPS[serverIndex]?.label})
            </Btn>
          ) : null}
        </div>
      </div>

      {restoredDraftAt ? (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-secondary/70 px-4 py-2.5 text-xs">
          <span>
            پیش‌نویس ذخیره‌شدهٔ مرورگر برای حساب شما بازیابی شد ({new Date(restoredDraftAt).toLocaleTimeString("fa-IR")}).
          </span>
          <button
            type="button"
            onClick={() => {
              clearSupplyDraft(userKey, selectedCaseId || null);
              setRestoredDraftAt("");
              setDraft(EMPTY_DRAFT);
            }}
            className="inline-flex items-center gap-1 font-semibold text-destructive hover:underline"
          >
            <RotateCcw size={12} />
            پاک کردن پیش‌نویس محلی
          </button>
        </div>
      ) : null}

      {feedback ? (
        <div role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm text-foreground">
          <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
          <span>{feedback}</span>
        </div>
      ) : null}
      {formError ? (
        <div role="alert" className="mb-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {formError}
        </div>
      ) : null}

      {isViewingFuture ? (
        <Card className="space-y-3 py-8 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
            <Lock size={20} />
          </div>
          <h3 className="text-base font-bold text-foreground">
            مرحلهٔ «{WIZARD_STEPS[currentIndex]?.label}» هنوز فعال نشده است
          </h3>
          <p className="mx-auto max-w-lg text-xs leading-relaxed text-muted-foreground">
            {guidance.futureLockReason}
          </p>
          <div>
            <Btn type="button" onClick={() => setViewedStepOverride(null)}>
              بازگشت به مرحلهٔ فعال پرونده
            </Btn>
          </div>
        </Card>
      ) : isViewingPast && activeCase ? (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <div>
              <Badge label="مرحلهٔ تکمیل‌شده (فقط‌خواندنی)" variant="success" dot />
              <h3 className="mt-1 text-sm font-bold text-foreground">
                خلاصهٔ ثبت‌شده در مرحلهٔ «{WIZARD_STEPS[currentIndex]?.label}»
              </h3>
            </div>
            <Btn type="button" onClick={() => setViewedStepOverride(null)}>
              ادامه در مرحلهٔ جاری
            </Btn>
          </div>
          <div className="grid gap-3 text-xs sm:grid-cols-3">
            <div className="rounded-xl bg-secondary p-3">
              <span className="text-muted-foreground">کد پرونده و شخص</span>
              <strong className="mt-1 block text-foreground">
                {activeCase.code} · {activeCase.contact_name}
              </strong>
            </div>
            <div className="rounded-xl bg-secondary p-3">
              <span className="text-muted-foreground">رنج و مشاور مسئول</span>
              <strong className="mt-1 block text-foreground">
                {activeCase.scope_name} · {activeCase.assigned_to_name || "تعیین‌نشده"}
              </strong>
            </div>
            <div className="rounded-xl bg-secondary p-3">
              <span className="text-muted-foreground">شرح اولیه</span>
              <strong className="mt-1 block text-foreground">{activeCase.description || "نامشخص"}</strong>
            </div>
          </div>
        </Card>
      ) : currentStep === "lead" ? (
        <Card>
          <form onSubmit={handleCreateLead} className="space-y-4">
            <h3 className="text-base font-bold text-foreground">مرحلهٔ ۱: ثبت سرنخ و شخص مرتبط</h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => updateDraft("contactMode", "new")}
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                  draft.contactMode === "new" ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground"
                }`}
              >
                ثبت شخص جدید
              </button>
              <button
                type="button"
                onClick={() => updateDraft("contactMode", "existing")}
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                  draft.contactMode === "existing" ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground"
                }`}
              >
                انتخاب از اشخاص موجود
              </button>
            </div>

            {draft.contactMode === "new" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="نام کامل مالک / معرف (الزامی)">
                  <input
                    value={draft.contactFullName}
                    onChange={(e) => updateDraft("contactFullName", e.target.value)}
                    placeholder="مانند رضا کریمی"
                    className={inputCls}
                  />
                  {fieldErrors.contactFullName ? (
                    <span className="mt-1 block text-xs text-destructive">{fieldErrors.contactFullName}</span>
                  ) : null}
                </Field>
                <Field label="شماره تماس (الزامی)">
                  <input
                    value={draft.contactPhone}
                    onChange={(e) => updateDraft("contactPhone", e.target.value)}
                    placeholder="09121234567"
                    className={inputCls}
                  />
                  {fieldErrors.contactPhone ? (
                    <span className="mt-1 block text-xs text-destructive">{fieldErrors.contactPhone}</span>
                  ) : null}
                </Field>
              </div>
            ) : (
              <ContactCombobox
                label="شخص موجود در CRM"
                required
                loading={loading && !contacts.length}
                contacts={contacts as ContactComboboxRow[]}
                value={draft.existingContactId}
                onChange={(next) => updateDraft("existingContactId", next)}
                error={fieldErrors.existingContactId}
              />
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="منبع سرنخ">
                <select
                  value={draft.leadSource}
                  onChange={(e) => updateDraft("leadSource", e.target.value)}
                  className={inputCls}
                >
                  {LEAD_SOURCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="انواع معاملهٔ مد نظر مالک">
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {dealTypes.map((dt) => {
                    const checked = draft.desiredDealTypes.includes(dt.id);
                    return (
                      <button
                        key={dt.id}
                        type="button"
                        onClick={() =>
                          updateDraft(
                            "desiredDealTypes",
                            checked
                              ? draft.desiredDealTypes.filter((id) => id !== dt.id)
                              : [...draft.desiredDealTypes, dt.id],
                          )
                        }
                        className={`rounded-lg border px-2.5 py-1 text-xs ${
                          checked ? "border-primary bg-primary/15 font-semibold text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {dt.display_name}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>

            <Field label="خلاصهٔ اولیهٔ ملک و توضیحات سرنخ (الزامی)">
              <textarea
                rows={3}
                value={draft.leadSummary}
                onChange={(e) => updateDraft("leadSummary", e.target.value)}
                placeholder="محدودهٔ تقریبی، نوع ملک، متراژ تقریبی و خواستهٔ اولیهٔ مالک"
                className={inputCls}
              />
              {fieldErrors.leadSummary ? (
                <span className="mt-1 block text-xs text-destructive">{fieldErrors.leadSummary}</span>
              ) : null}
            </Field>

            <div className="flex justify-end">
              <Btn type="submit" disabled={busy}>
                ثبت سرنخ و ایجاد پرونده
              </Btn>
            </div>
          </form>
        </Card>
      ) : activeCase && currentStep === "reception" ? (
        <Card className="space-y-4">
          <h3 className="text-base font-bold text-foreground">مرحلهٔ ۲: پذیرش سرنخ توسط مدیر رنج</h3>
          <p className="text-xs text-muted-foreground">
            پرونده <strong>{activeCase.code}</strong> برای <strong>{activeCase.contact_name}</strong> ثبت شده است.
          </p>
          {isManager ? (
            <Btn
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await post(csrfToken, `/crm/api/property-cases/${activeCase.id}/accept_lead/`, {
                    version: activeCase.version,
                  });
                  emitSupplyCountersRefresh();
                  setFeedback("سرنخ پذیرفته شد؛ اکنون مشاور مسئول و مهلت کارشناسی را مشخص کنید.");
                  reload();
                } catch (err) {
                  setFormError(err instanceof Error ? err.message : "پذیرش سرنخ ناموفق بود.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              تأیید و پذیرش سرنخ
            </Btn>
          ) : (
            <div className="rounded-xl bg-secondary p-4 text-xs text-muted-foreground">
              سرنخ در انتظار بررسی و پذیرش مدیر رنج است. به محض پذیرش و ارجاع، اعلان برای شما ارسال می‌شود.
            </div>
          )}
        </Card>
      ) : activeCase && currentStep === "assignment" ? (
        <Card className="space-y-4">
          <h3 className="text-base font-bold text-foreground">مرحلهٔ ۳: ارجاع به مشاور و تعیین مهلت الزامی</h3>
          {isManager ? (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (!assigneeId || !dueAt) {
                  setFormError("انتخاب مشاور مسئول و مهلت انجام کارشناسی الزامی است.");
                  return;
                }
                setBusy(true);
                setFormError("");
                try {
                  await post(csrfToken, `/crm/api/property-cases/${activeCase.id}/assign/`, {
                    assigned_to: Number(assigneeId),
                    due_at: new Date(dueAt).toISOString(),
                    version: activeCase.version,
                  });
                  emitSupplyCountersRefresh();
                  setFeedback("پرونده با مهلت مشخص به مشاور ارجاع شد.");
                  reload();
                } catch (err) {
                  setFormError(err instanceof Error ? err.message : "ارجاع پرونده ناموفق بود.");
                } finally {
                  setBusy(false);
                }
              }}
              className="grid gap-3 sm:grid-cols-3"
            >
              <ConsultantCombobox
                label="مشاور مسئول"
                required
                consultants={assignableStaff}
                allowedRoles={["AGENT", "RANGE_MANAGER", "ADMIN"]}
                loading={staffLoading}
                value={assigneeId}
                onChange={setAssigneeId}
              />
              <JalaliDateTimeInput name="due_at" label="مهلت کارشناسی (الزامی)" value={dueAt} onChange={setDueAt} required />
              <div className="flex items-end">
                <Btn type="submit" disabled={busy}>
                  ثبت ارجاع
                </Btn>
              </div>
            </form>
          ) : (
            <p className="rounded-xl bg-secondary p-4 text-xs text-muted-foreground">
              در انتظار تعیین مشاور مسئول و مهلت کارشناسی توسط مدیر رنج.
            </p>
          )}
        </Card>
      ) : activeCase && currentStep === "acceptance" ? (
        <Card className="space-y-4">
          <h3 className="text-base font-bold text-foreground">مرحلهٔ ۴: پذیرش یا رد ارجاع توسط مشاور</h3>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-secondary p-3.5 text-xs">
            <span>مشاور ارجاع‌شده: <strong>{activeCase.assigned_to_name || "نامشخص"}</strong></span>
            <span>مهلت تعیین‌شده: <strong>{activeCase.due_at ? new Date(activeCase.due_at).toLocaleString("fa-IR") : "نامشخص"}</strong></span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setFormError("");
                try {
                  await post(csrfToken, `/crm/api/property-cases/${activeCase.id}/accept_assignment/`, {
                    version: activeCase.version,
                  });
                  emitSupplyCountersRefresh();
                  setFeedback("ارجاع پذیرفته شد؛ فرم کارشناسی ملک اکنون فعال است.");
                  reload();
                } catch (err) {
                  setFormError(err instanceof Error ? err.message : "پذیرش ارجاع ناموفق بود.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              پذیرش ارجاع و شروع کارشناسی
            </Btn>
          </div>
          <div className="grid gap-2 border-t pt-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="در صورت عدم امکان انجام کارشناسی، علت دقیق رد ارجاع را بنویسید"
                className={inputCls}
              />
            </div>
            <Btn
              type="button"
              color="danger"
              disabled={busy}
              onClick={async () => {
                if (!rejectReason.trim()) {
                  setFormError("ثبت دلیل برای رد ارجاع الزامی است.");
                  return;
                }
                setBusy(true);
                setFormError("");
                try {
                  await post(csrfToken, `/crm/api/property-cases/${activeCase.id}/reject_assignment/`, {
                    reason: rejectReason.trim(),
                    version: activeCase.version,
                  });
                  emitSupplyCountersRefresh();
                  setFeedback("ارجاع با ذکر دلیل به مدیر رنج بازگردانده شد.");
                  reload();
                } catch (err) {
                  setFormError(err instanceof Error ? err.message : "رد ارجاع ناموفق بود.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              رد ارجاع با ذکر دلیل
            </Btn>
          </div>
        </Card>
      ) : activeCase && currentStep === "appraisal" ? (
        <Card className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <div>
              <h3 className="text-base font-bold text-foreground">مرحلهٔ ۵: تکمیل مشخصات ملک، مالکان و گزارش کارشناسی</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                ذخیرهٔ این بخش فقط ملک و گزارش کارشناسی را ثبت می‌کند و هیچ فایل عرضه‌ای پیش از تأیید مدیر ایجاد نمی‌شود.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={isManager ? "عنوان مدیریتی ملک (اختصاصی مدیر)" : "عنوان مدیریتی ملک (توسط مدیر تعیین می‌شود)"}>
              <input
                value={draft.propertyTitle}
                onChange={(e) => updateDraft("propertyTitle", e.target.value)}
                readOnly={!isManager}
                placeholder={isManager ? "مانند آپارتمان ۱۴۵ متری جردن" : "فقط قابل مشاهده برای مشاور"}
                className={`${inputCls} ${!isManager ? "opacity-70" : ""}`}
              />
            </Field>
            <Field label="نوع مرجع ملک">
              <select
                value={draft.propertyTypeRef}
                disabled={catalogLoading || !catalog?.propertyTypes.length}
                onChange={(e) => {
                  const type = catalog?.propertyTypes.find((item) => String(item.id) === e.target.value);
                  updateDraft("propertyTypeRef", e.target.value);
                  updateDraft("propertyUsageId", String(type?.propertyUsage ?? ""));
                  updateDraft("attributes", {});
                  setFieldErrors((previous) => {
                    const next = { ...previous };
                    delete next.propertyTypeRef;
                    delete next.attributes;
                    for (const field of [...(propertySchema?.fields || []), ...(propertySchema?.facilities || [])]) {
                      delete next[field.name];
                    }
                    return next;
                  });
                }}
                className={inputCls}
              >
                <option value="">{catalogLoading ? "در حال بارگذاری انواع ملک…" : "انتخاب نوع ملک"}</option>
                {(catalog?.propertyTypes || []).map((type) => (
                  <option key={type.id} value={String(type.id)}>{type.displayName}</option>
                ))}
              </select>
              {fieldErrors.propertyTypeRef ? <span className="mt-1 block text-xs text-destructive">{fieldErrors.propertyTypeRef}</span> : null}
            </Field>
            <Field label="کاربری">
              <input
                readOnly
                value={selectedPropertyType?.propertyUsageName || catalog?.usages.find((item) => String(item.id) === draft.propertyUsageId)?.displayName || ""}
                placeholder="بر اساس نوع ملک تعیین می‌شود"
                className={`${inputCls} opacity-80`}
              />
            </Field>
          </div>

          <div className="space-y-3 rounded-xl border border-border p-3.5">
            <div>
              <h4 className="text-sm font-bold text-foreground">ویژگی‌های ملک</h4>
              <p className="mt-1 text-xs text-muted-foreground">متراژ برای همهٔ انواع ملک مشترک است؛ سایر ویژگی‌ها بر اساس نوع مرجع انتخاب‌شده بارگذاری می‌شوند.</p>
            </div>
            <Field label="متراژ به متر مربع (الزامی)">
              <input
                type="number"
                min={1}
                value={draft.area}
                onChange={(e) => updateDraft("area", e.target.value)}
                className={inputCls}
              />
              {fieldErrors.area ? <span className="mt-1 block text-xs text-destructive">{fieldErrors.area}</span> : null}
            </Field>
            <DynamicAttributeFields
              schema={propertySchema}
              values={draft.attributes}
              onChange={updateAttribute}
              errors={fieldErrors}
              loading={schemaLoading}
            />
            {fieldErrors.attributes ? <span className="block text-xs text-destructive">{fieldErrors.attributes}</span> : null}
          </div>

          <div role="separator" aria-hidden="true" className="border-t border-border" />

          <div className="space-y-2">
            <span className="block text-sm text-muted-foreground">موقعیت سلسله‌مراتبی ملک (استان، شهر و محله)</span>
            <LocationSelect
              tree={locationTree}
              provinceId={draft.provinceId}
              cityId={draft.cityId}
              districtId={draft.districtId}
              onProvinceChange={(value) => {
                updateDraft("provinceId", value);
                updateDraft("cityId", "");
                updateDraft("districtId", "");
                updateDraft("neighborhood", "");
              }}
              onCityChange={(value) => {
                updateDraft("cityId", value);
                updateDraft("districtId", "");
                updateDraft("neighborhood", "");
              }}
              onDistrictChange={(value) => {
                const province = locationTree.find((item) => String(item.id) === draft.provinceId);
                const city = province?.cities.find((item) => String(item.id) === draft.cityId);
                const district = city?.districts.find((item) => String(item.id) === value);
                updateDraft("districtId", value);
                updateDraft("neighborhood", district?.displayName || "");
              }}
              errors={fieldErrors}
              required
            />
            {locationLoading ? <span className="text-xs text-muted-foreground">در حال بارگذاری درخت مکان…</span> : null}
          </div>

          <Field label="نشانی دقیق ملک (محرمانه در سامانهٔ داخلی — الزامی)">
            <input
              value={draft.address}
              onChange={(e) => updateDraft("address", e.target.value)}
              placeholder="خیابان، کوچه، پلاک و واحد"
              className={inputCls}
            />
            {fieldErrors.address ? <span className="mt-1 block text-xs text-destructive">{fieldErrors.address}</span> : null}
          </Field>

          <section className="space-y-3 rounded-xl border border-border p-3.5">
            <div className="flex items-start gap-2">
              <MapPin size={16} className="mt-0.5 text-primary" />
              <div>
                <h4 className="text-sm font-bold text-foreground">مختصات دقیق روی نقشه (اختیاری)</h4>
                <p className="mt-1 text-xs text-muted-foreground">نقطه را روی نقشه انتخاب کنید یا مختصات را وارد کنید. نشانی و مختصات دقیق فقط برای کاربران مجاز داخلی است.</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="عرض جغرافیایی">
                <input value={draft.latitude} onChange={(e) => updateDraft("latitude", e.target.value)} inputMode="decimal" placeholder="مثال: 35.7219" className={inputCls} />
                {fieldErrors.latitude ? <span className="mt-1 block text-xs text-destructive">{fieldErrors.latitude}</span> : null}
              </Field>
              <Field label="طول جغرافیایی">
                <input value={draft.longitude} onChange={(e) => updateDraft("longitude", e.target.value)} inputMode="decimal" placeholder="مثال: 51.3347" className={inputCls} />
                {fieldErrors.longitude ? <span className="mt-1 block text-xs text-destructive">{fieldErrors.longitude}</span> : null}
              </Field>
            </div>
            <PropertyMapPicker
              value={mapPoint}
              onChange={(point) => {
                updateDraft("latitude", String(point[0]));
                updateDraft("longitude", String(point[1]));
              }}
              provinceName={selectedLocationNames.provinceName}
              cityName={selectedLocationNames.cityName}
              districtName={selectedLocationNames.districtName}
              csrfToken={csrfToken}
            />
          </section>

          <div role="separator" aria-hidden="true" className="border-t border-border" />

          <section className="space-y-3 rounded-xl border border-border p-3.5">
            <div className="flex items-start gap-2">
              <ImageIcon size={16} className="mt-0.5 text-primary" />
              <div>
                <h4 className="text-sm font-bold text-foreground">تصاویر ملک</h4>
                <p className="mt-1 text-xs text-muted-foreground">JPEG، PNG یا WebP؛ حداکثر ۵ مگابایت برای هر تصویر و ۳۰ تصویر برای هر ملک. تصاویر پیش از ارسال برای بررسی مدیر بارگذاری می‌شوند.</p>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(event) => {
                addGalleryFiles(Array.from(event.target.files || []));
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); addGalleryFiles(Array.from(event.dataTransfer.files || [])); }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-5 text-sm font-semibold hover:border-primary hover:bg-primary/5"
            >
              <Upload size={16} /> افزودن تصویر
            </button>
            {galleryError ? <p role="alert" className="text-xs text-destructive">{galleryError}</p> : null}
            {existingImages.length ? (
              <div>
                <p className="mb-2 text-xs font-semibold text-muted-foreground">تصاویر ذخیره‌شدهٔ ملک ({existingImages.length})</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {existingImages.map((image) => (
                    <a key={image.id} href={image.url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg bg-secondary">
                      <img src={image.url} alt={`تصویر ذخیره‌شدهٔ ملک ${image.id}`} className="h-full w-full object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
            {galleryPreviews.length ? (
              <div data-testid="gallery-queue" className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
                {galleryPreviews.map(({ file, url }, index) => {
                  const key = `${file.name}:${file.size}:${file.lastModified}`;
                  const isDragging = queueDragIndex === index;
                  const isDropTarget = queueDropIndex === index && queueDragIndex !== index;
                  return (
                    <div
                      key={key}
                      draggable
                      onDragStart={(event) => {
                        setQueueDragIndex(index);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", String(index));
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setQueueDropIndex(index);
                      }}
                      onDragLeave={() => setQueueDropIndex((current) => (current === index ? null : current))}
                      onDrop={(event) => {
                        event.preventDefault();
                        const from = queueDragIndex ?? Number(event.dataTransfer.getData("text/plain"));
                        setQueueDropIndex(null);
                        setQueueDragIndex(null);
                        moveGalleryItem(Number.isFinite(from) ? from : index, index);
                      }}
                      onDragEnd={() => {
                        setQueueDragIndex(null);
                        setQueueDropIndex(null);
                      }}
                      className={`group relative aspect-square w-24 flex-shrink-0 overflow-hidden rounded-lg bg-secondary transition-all ${
                        isDragging ? "opacity-40" : ""
                      } ${isDropTarget ? "ring-2 ring-primary ring-offset-2" : ""}`}
                    >
                      <img
                        src={url}
                        alt={`پیش‌نمایش ${(index + 1).toLocaleString("fa-IR")}`}
                        className="pointer-events-none h-full w-full object-cover"
                      />
                      {/* Delete sits top-right, the reorder handle top-left, like the gallery tab. */}
                      <button
                        type="button"
                        aria-label={`حذف ${file.name}`}
                        onClick={() => setGallery((previous) => previous.filter((item) => item !== file))}
                        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-destructive"
                      >
                        <X size={13} />
                      </button>
                      <span
                        aria-hidden="true"
                        title="جابه‌جایی با کشیدن"
                        className="absolute left-1 top-1 flex h-6 w-6 cursor-grab items-center justify-center rounded-full bg-background/90 text-muted-foreground active:cursor-grabbing"
                      >
                        <GripVertical size={13} />
                      </span>
                      <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-white">
                        {(index + 1).toLocaleString("fa-IR")}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              در صف بارگذاری: {gallery.length.toLocaleString("fa-IR")} تصویر؛ تصاویر به همین ترتیب ثبت می‌شوند و
              بارگذاری موفق از صف حذف می‌شود تا در تلاش مجدد دوباره ثبت نشود. برای جابه‌جایی، هر تصویر را بکشید.
            </p>
          </section>

          <div role="separator" aria-hidden="true" className="border-t border-border" />

          <div className="space-y-2 rounded-xl border border-border p-3.5">
            <div className="flex items-center justify-between">
              <strong className="text-xs font-bold text-foreground">مالکان و نمایندگان قانونی ملک (PropertyParty)</strong>
              <button
                type="button"
                onClick={() =>
                  updateDraft("parties", [
                    ...draft.parties,
                    { fullName: "", phone: "", role: "OWNER_REPRESENTATIVE", sharePercent: "", isPrimary: false },
                  ])
                }
                className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold hover:bg-secondary"
              >
                <Plus size={12} />
                افزودن مالک / نماینده
              </button>
            </div>
            {draft.parties.map((party, idx) => (
              <div key={idx} className="grid gap-2 sm:grid-cols-5">
                <input
                  value={party.fullName}
                  onChange={(e) => {
                    const next = [...draft.parties];
                    next[idx] = { ...next[idx], fullName: e.target.value };
                    updateDraft("parties", next);
                  }}
                  placeholder="نام کامل"
                  className={inputCls}
                />
                <input
                  value={party.phone}
                  onChange={(e) => {
                    const next = [...draft.parties];
                    next[idx] = { ...next[idx], phone: e.target.value };
                    updateDraft("parties", next);
                  }}
                  placeholder="شماره تماس"
                  className={inputCls}
                />
                <select
                  value={party.role}
                  onChange={(e) => {
                    const next = [...draft.parties];
                    next[idx] = { ...next[idx], role: e.target.value as PropertyPartyRow["role"] };
                    updateDraft("parties", next);
                  }}
                  className={inputCls}
                >
                  <option value="OWNER">مالک</option>
                  <option value="OWNER_REPRESENTATIVE">نماینده مالک</option>
                </select>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={party.sharePercent ?? ""}
                  onChange={(e) => {
                    const next = [...draft.parties];
                    next[idx] = { ...next[idx], sharePercent: e.target.value };
                    updateDraft("parties", next);
                  }}
                  placeholder="سهم (٪)"
                  className={inputCls}
                />
                <div className="flex items-center justify-end">
                  {draft.parties.length > 1 ? (
                    <button
                      type="button"
                      aria-label="حذف ردیف شخص"
                      onClick={() => updateDraft("parties", draft.parties.filter((_, i) => i !== idx))}
                      className="rounded-lg p-2 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="متن کامل گزارش کارشناسی (الزامی)">
              <textarea
                rows={4}
                value={draft.reportText}
                onChange={(e) => updateDraft("reportText", e.target.value)}
                placeholder="کیفیت ساخت، نورگیری، وضعیت مشاعات، وضعیت سند و ارزیابی کارشناسی"
                className={inputCls}
              />
              {fieldErrors.reportText ? (
                <span className="mt-1 block text-xs text-destructive">{fieldErrors.reportText}</span>
              ) : null}
            </Field>
            <Field label="یادداشت‌های داخلی بازدید و هماهنگی کلید">
              <textarea
                rows={4}
                value={draft.visitNotes}
                onChange={(e) => updateDraft("visitNotes", e.target.value)}
                placeholder="نکات هماهنگی بازدید (محرمانه و غیرقابل نمایش در اکسپلور عمومی)"
                className={inputCls}
              />
            </Field>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
            <Btn type="button" color="light" disabled={busy} onClick={() => void handleSaveAppraisal(false)}>
              ذخیره پیش‌نویس کارشناسی
            </Btn>
            <Btn type="button" disabled={busy} onClick={() => void handleSaveAppraisal(true)}>
              ذخیره و ارسال برای تأیید مدیر
            </Btn>
          </div>
        </Card>
      ) : activeCase && currentStep === "review" ? (
        <Card className="space-y-4">
          <h3 className="text-base font-bold text-foreground">مرحلهٔ ۶: بررسی گزارش کارشناسی و تأیید ملک</h3>
          <div className="rounded-xl bg-secondary/70 p-4 text-xs leading-relaxed">
            <strong>گزارش کارشناسی ارسالی:</strong>
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
              {activeCase.appraisal?.report_text || "گزارش ثبت نشده است."}
            </p>
          </div>
          {isManager ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="عنوان مدیریتی ملک (الزامی برای تأیید)">
                  <input
                    value={draft.propertyTitle}
                    onChange={(e) => updateDraft("propertyTitle", e.target.value)}
                    placeholder="عنوان رسمی ملک"
                    className={inputCls}
                  />
                </Field>
                <Field label="نتیجه بررسی">
                  <select
                    value={reviewDecision}
                    onChange={(e) => setReviewDecision(e.target.value as "APPROVED" | "CHANGES_REQUIRED")}
                    className={inputCls}
                  >
                    <option value="APPROVED">تأیید نهایی ملک</option>
                    <option value="CHANGES_REQUIRED">نیازمند اصلاح کارشناسی</option>
                  </select>
                </Field>
              </div>
              {reviewDecision === "CHANGES_REQUIRED" ? (
                <Field label="علت نیازمند اصلاح بودن (الزامی)">
                  <textarea
                    rows={2}
                    value={reviewReason}
                    onChange={(e) => setReviewReason(e.target.value)}
                    className={inputCls}
                  />
                </Field>
              ) : null}
              <div className="flex justify-end gap-2">
                <Btn
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (reviewDecision === "APPROVED" && !draft.propertyTitle.trim()) {
                      setFormError("تعیین عنوان مدیریتی ملک پیش از تأیید نهایی الزامی است.");
                      return;
                    }
                    if (reviewDecision === "CHANGES_REQUIRED" && !reviewReason.trim()) {
                      setFormError("ثبت دلیل اصلاح برای بازگرداندن پرونده الزامی است.");
                      return;
                    }
                    setBusy(true);
                    setFormError("");
                    try {
                      await post(csrfToken, `/crm/api/property-cases/${activeCase.id}/review_property/`, {
                        decision: reviewDecision,
                        property_title: draft.propertyTitle.trim(),
                        reason: reviewReason.trim(),
                        case_version: activeCase.version,
                      });
                      emitSupplyCountersRefresh();
                      setFeedback(
                        reviewDecision === "APPROVED"
                          ? "ملک تأیید نهایی شد؛ اکنون می‌توانید فایل‌های عرضه را تعریف کنید."
                          : "پرونده برای اصلاح کارشناسی بازگردانده شد.",
                      );
                      reload();
                    } catch (err) {
                      setFormError(err instanceof Error ? err.message : "ثبت تصمیم بررسی ناموفق بود.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  ثبت تصمیم نهایی بررسی
                </Btn>
              </div>
            </div>
          ) : (
            <p className="rounded-xl bg-secondary p-4 text-xs text-muted-foreground">
              گزارش کارشناسی در صف تأیید مدیر رنج قرار دارد.
            </p>
          )}
        </Card>
      ) : activeCase ? (
        <div className="space-y-4">
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">
                  مرحلهٔ ۷: تعریف و مدیریت فایل‌های عرضه برای ملک «{activeCase.property_title}»
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  برای هر نوع معاملهٔ فعال، یک فایل عرضه با شرایط اختصاصی همان نوع معامله ثبت یا به‌روزرسانی می‌شود.
                </p>
              </div>
              {propId ? (
                <div className="flex gap-2">
                  <Btn type="button" color="light" onClick={() => navigate("property-detail", propId)}>
                    صفحهٔ جزئیات ملک
                  </Btn>
                  <Btn type="button" color="light" onClick={() => navigate("property-files-explore")}>
                    اکسپلور فایل‌ها
                  </Btn>
                </div>
              ) : null}
            </div>

            {dealTypePreview ? (
              <div role="alert" className="space-y-2 rounded-xl border border-amber-500/45 bg-amber-500/10 p-3.5 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-foreground">
                  <AlertTriangle size={15} className="text-amber-600 dark:text-amber-400" />
                  <span>پیش‌نمایش تأثیر تغییر نوع معامله</span>
                </div>
                <p className="text-muted-foreground">
                  با تغییر نوع معامله، فیلدهای ناسازگار زیر بدون انتقال پنهان حذف می‌شوند:{" "}
                  <strong className="text-foreground">
                    {dealTypePreview.incompatibleFields.map((f) => f.label).join("، ")}
                  </strong>
                </p>
                <div className="flex gap-2">
                  <Btn type="button" onClick={confirmDealTypeSwitch}>
                    تأیید و تغییر نوع معامله
                  </Btn>
                  <Btn
                    type="button"
                    color="light"
                    onClick={() => {
                      setPendingDealTypeId("");
                      setDealTypePreview(null);
                    }}
                  >
                    انصراف
                  </Btn>
                </div>
              </div>
            ) : null}

            <form onSubmit={handleSaveListing} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="نوع معامله (نسخهٔ منتشرشده)">
                  <select
                    value={selectedDealTypeId}
                    onChange={(e) => handleDealTypeSelect(e.target.value)}
                    className={inputCls}
                    required
                  >
                    <option value="">انتخاب نوع معامله</option>
                    {dealTypes.map((dt) => (
                      <option key={dt.id} value={String(dt.id)}>
                        {dt.display_name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="وضعیت فایل عرضه">
                  <select
                    value={listingStatus}
                    onChange={(e) => setListingStatus(e.target.value as "DRAFT" | "ACTIVE" | "PAUSED")}
                    className={inputCls}
                  >
                    <option value="ACTIVE">فعال (نمایش در اکسپلور)</option>
                    <option value="DRAFT">پیش‌نویس</option>
                    <option value="PAUSED">متوقف</option>
                  </select>
                </Field>
              </div>

              {currentSchema?.fields?.length ? (
                <div className="grid gap-3 rounded-xl border p-3.5 sm:grid-cols-2">
                  {currentSchema.fields.map((field) => (
                    <Field
                      key={field.key}
                      label={`${field.label}${field.unit ? ` (${field.unit})` : ""}${field.required ? " *" : ""}`}
                    >
                      {field.type === "boolean" ? (
                        <input
                          type="checkbox"
                          checked={Boolean(listingTerms[field.key])}
                          onChange={(e) =>
                            setListingTerms((prev) => ({ ...prev, [field.key]: e.target.checked }))
                          }
                        />
                      ) : (
                        <input
                          type={field.type === "integer" || field.type === "decimal" ? "number" : field.type === "date" ? "date" : "text"}
                          value={String(listingTerms[field.key] ?? "")}
                          onChange={(e) =>
                            setListingTerms((prev) => ({
                              ...prev,
                              [field.key]:
                                field.type === "integer" || field.type === "decimal"
                                  ? e.target.value === ""
                                    ? ""
                                    : Number(e.target.value)
                                  : e.target.value,
                            }))
                          }
                          required={field.required}
                          className={inputCls}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              ) : null}

              <Field label="توضیحات عمومی فایل عرضه">
                <textarea
                  rows={2}
                  value={listingDescription}
                  onChange={(e) => setListingDescription(e.target.value)}
                  placeholder="توضیحات قابل نمایش برای معرفی و اکسپلور"
                  className={inputCls}
                />
              </Field>

              <div className="flex justify-end">
                <Btn type="submit" disabled={busy || !selectedDealTypeId}>
                  ذخیره فایل عرضه
                </Btn>
              </div>
            </form>
          </Card>

          <Card className="space-y-3">
            <h4 className="text-sm font-bold text-foreground">
              فایل‌های عرضهٔ ثبت‌شده برای این ملک ({formatFaInt(propertyListings.length, "۰")})
            </h4>
            {!propertyListings.length ? (
              <EmptyState
                title="هنوز فایل عرضه‌ای برای این ملک ثبت نشده است"
                description="از فرم بالا اولین فایل عرضه را بر اساس نوع معاملهٔ مورد نظر ایجاد کنید."
              />
            ) : (
              <div className="space-y-2">
                {propertyListings.map((lf) => {
                  const meta = supplyStatusBadgeMeta("listing", lf.status);
                  const saleVal = lf.salePrice ?? lf.sale_price;
                  const depVal = lf.deposit;
                  const rentVal = lf.monthlyRent ?? lf.monthly_rent;
                  return (
                    <div key={lf.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-xs">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <strong className="text-sm text-foreground">{lf.title}</strong>
                          <Badge label={meta.label} variant={meta.variant} dot />
                          {lf.dealTypeDisplay ? (
                            <span className="text-muted-foreground">({lf.dealTypeDisplay})</span>
                          ) : null}
                        </div>
                        <div className="text-muted-foreground">
                          {saleVal ? `ثمن: ${formatFaAmount(saleVal)} ` : ""}
                          {depVal ? `ودیعه: ${formatFaAmount(depVal)} ` : ""}
                          {rentVal ? `اجاره: ${formatFaAmount(rentVal)}` : ""}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {lf.status !== "PAUSED" ? (
                          <Btn
                            type="button"
                            color="light"
                            onClick={async () => {
                              await patch(csrfToken, `/crm/api/listings/${lf.id}/`, {
                                deal_type: lf.dealType ?? lf.deal_type,
                                status: "PAUSED",
                              });
                              propLoad.reload();
                            }}
                          >
                            توقف عرضه
                          </Btn>
                        ) : (
                          <Btn
                            type="button"
                            color="light"
                            onClick={async () => {
                              await patch(csrfToken, `/crm/api/listings/${lf.id}/`, {
                                deal_type: lf.dealType ?? lf.deal_type,
                                status: "ACTIVE",
                              });
                              propLoad.reload();
                            }}
                          >
                            فعال‌سازی مجدد
                          </Btn>
                        )}
                        <Btn type="button" color="light" onClick={() => navigate("property-file-detail", lf.id)}>
                          جزئیات فایل
                        </Btn>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      <AccessibleModal
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          syncWizardUrlParams(selectedCaseId || null);
        }}
        title="ادامهٔ پروندهٔ قبلی"
        subtitle="جست‌وجو بر اساس کد پرونده، نام شخص، عنوان ملک یا رنج (حساسیت یکسان برای ارقام و حروف فارسی/عربی)"
        maxWidthClass="max-w-2xl"
      >
        <SearchBar
          value={pickerSearch}
          onChange={setPickerSearch}
          placeholder="کد پرونده، نام مالک یا محله را وارد کنید…"
        />
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {pickerFilteredCases.map((item) => {
            const stall = computeStallInfo(item);
            return (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-xs hover:bg-secondary/40"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <strong className="font-mono text-foreground">{item.code}</strong>
                    <Badge label={STAGE_LABELS_FA[item.stage] || item.stage} variant="teal" dot />
                    {stall.isStalled ? <Badge label="راکد" variant="danger" /> : null}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {item.property_title || item.description || item.contact_name} · مسئول: {item.assigned_to_name || "تعیین‌نشده"}
                  </div>
                </div>
                <Btn
                  type="button"
                  onClick={() => {
                    setSelectedCaseId(String(item.id));
                    setPickerOpen(false);
                    syncWizardUrlParams(item.id);
                  }}
                >
                  انتخاب و ادامه
                </Btn>
              </div>
            );
          })}
          {!pickerFilteredCases.length ? (
            <p className="py-6 text-center text-xs text-muted-foreground">پروندهٔ منطبقی یافت نشد.</p>
          ) : null}
        </div>
      </AccessibleModal>

      <AccessibleModal
        open={reviewSummaryOpen && Boolean(activeCase)}
        onClose={() => {
          setReviewSummaryOpen(false);
          syncWizardUrlParams(activeCase?.id || null);
        }}
        title="درخواست تأیید ملک ثبت شد"
        subtitle="خلاصهٔ اطلاعات کارشناسی ارسال‌شده به صف بررسی مدیر رنج"
        maxWidthClass="max-w-lg"
      >
        {activeCase ? (
          <div className="space-y-3 text-xs">
            <div className="rounded-xl bg-secondary p-3.5 space-y-1.5">
              <div>کد پرونده: <strong className="font-mono">{activeCase.code}</strong></div>
              <div>شخص مرتبط: <strong>{activeCase.contact_name}</strong></div>
              <div>نسخهٔ ارسالی بررسی: <strong>{formatFaInt(submittedReviewVersion ?? activeCase.version)}</strong></div>
              <div>وضعیت کنونی: <strong>در انتظار بررسی و تأیید مدیر رنج</strong></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Btn
                type="button"
                color="light"
                onClick={() => {
                  setReviewSummaryOpen(false);
                  navigate("crm-property-cases", activeCase.id);
                }}
              >
                مشاهده پرونده
              </Btn>
              <Btn
                type="button"
                onClick={() => {
                  setReviewSummaryOpen(false);
                  syncWizardUrlParams(activeCase.id);
                }}
              >
                متوجه شدم
              </Btn>
            </div>
          </div>
        ) : null}
      </AccessibleModal>
    </Shell>
  );
}

export const PropertyRegister = PropertyRegisterPage;
