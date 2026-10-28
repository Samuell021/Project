import React, { useEffect, useRef, useState } from "react";
import { Badge } from "../../../shared/components/ui/Badge";
import { Btn } from "../../../shared/components/ui/Btn";
import { Card } from "../../../shared/components/ui/Card";
import { apiErrorMessage, apiFetch, readJson } from "../../../shared/lib/apiClient";
import { fmtShort, toPersianChannel, toPersianDeal } from "../../../shared/lib/utils";
import { formatJalaliDT } from "../../../shared/lib/jdate";
import {
  EMPTY_PROPERTY_FILE_INQUIRY,
  buildPropertyFileInquiryPayload,
  propertyFileInquiryValidationError,
  propertyFilePriceLabel,
  propertyFilePriceParts,
} from "../../../shared/lib/propertyFileExplore";
import type {
  PropertyFileExploreAttribute,
  PropertyFileExploreDetail,
  PropertyFileInquiryDraft,
} from "../../../shared/lib/propertyFileExplore";
import type { Page } from "../../../shared/lib/types";
import { Building2, CheckCircle2, FileText, RefreshCw, Send, UserRound, X } from "lucide-react";

const PROPERTY_FILE_UNAVAILABLE_MESSAGE = "این فایل در دسترس نیست؛ ممکن است وضعیت آن تغییر کرده باشد";

const attributeText = (attribute: PropertyFileExploreAttribute): string => {
  const raw = attribute.displayValue ?? attribute.value;
  const text = raw === null || raw === undefined ? "" : String(raw);
  return attribute.unit ? `${text} ${attribute.unit}`.trim() : text;
};

function PropertyFileDetailModal({
  propertyFileId,
  onClose,
  navigate,
  onIntroduced,
  onRefresh,
}: {
  propertyFileId: string | number;
  onClose: () => void;
  navigate: (page: Page, id?: string | number) => void;
  onIntroduced?: (propertyFileId: number) => void;
  onRefresh?: () => void;
}) {
  const [detail, setDetail] = useState<PropertyFileExploreDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [inquiry, setInquiry] = useState<PropertyFileInquiryDraft>(EMPTY_PROPERTY_FILE_INQUIRY);
  const [inquiryError, setInquiryError] = useState<string | null>(null);
  const [inquirySending, setInquirySending] = useState(false);
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inquiryController = useRef<AbortController | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const controller = new AbortController();
    inquiryController.current?.abort();
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    setInquiry(EMPTY_PROPERTY_FILE_INQUIRY);
    setInquiryError(null);
    setInquirySending(false);
    setTicketNumber(null);
    apiFetch(`/property-files/api/property-files/explore/${propertyFileId}/`, {
      method: "GET",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await readJson(response);
        if (!response.ok) throw new Error(PROPERTY_FILE_UNAVAILABLE_MESSAGE);
        return data;
      })
      .then((data) => {
        if (!controller.signal.aborted) setDetail(data);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setDetail(null);
        setDetailError(PROPERTY_FILE_UNAVAILABLE_MESSAGE);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [propertyFileId, detailRevision]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const elements = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]'
      ));
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) {
        event.preventDefault();
        dialogRef.current.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      inquiryController.current?.abort();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const refreshResults = () => {
    onClose();
    if (onRefresh) onRefresh();
    else navigate("property-files-explore");
  };

  const submitInquiry = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail || inquirySending) return;
    const validationError = propertyFileInquiryValidationError(inquiry);
    if (validationError) {
      setInquiryError(validationError);
      return;
    }
    const controller = new AbortController();
    inquiryController.current = controller;
    setInquirySending(true);
    setInquiryError(null);
    try {
      const response = await apiFetch("/tickets/api/property-file-inquiries/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPropertyFileInquiryPayload(detail.id, inquiry)),
        signal: controller.signal,
      });
      const data = await readJson(response);
      if (controller.signal.aborted) return;
      if (response.status === 404 || response.status === 410) {
        setDetail(null);
        setDetailError(PROPERTY_FILE_UNAVAILABLE_MESSAGE);
        return;
      }
      if (!response.ok) {
        setInquiryError(apiErrorMessage(data, "ثبت معرفی به مشتری انجام نشد."));
        return;
      }
      setTicketNumber(String(data?.ticketNumber || ""));
      setInquiry(EMPTY_PROPERTY_FILE_INQUIRY);
      onIntroduced?.(detail.id);
    } catch {
      if (!controller.signal.aborted) setInquiryError("در ارتباط با سامانه خطایی رخ داد. دوباره تلاش کنید.");
    } finally {
      if (!controller.signal.aborted) setInquirySending(false);
    }
  };

  const detailPriceParts = detail ? propertyFilePriceParts(detail) : [];
  const detailFacilities = (detail?.attributeDetails || []).filter((attribute) => attribute.isFacility);
  const detailSpecs = (detail?.attributeDetails || []).filter(
    (attribute) => !attribute.isFacility && attributeText(attribute).length > 0
  );

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 backdrop-blur-sm sm:p-6"
    >
      <Card
        className="w-full max-w-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label="جزئیات فایل و معرفی به مشتری"
          className="flex max-h-[calc(100vh-3rem)] flex-col"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-bold">{detail?.title || "جزئیات فایل"}</h2>
                {(!detail || !detail.isMine) && <Badge label="فقط‌خواندنی" variant="muted" />}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {detail && (
                  <>
                    <span>{detail.channelDisplay || toPersianChannel(detail.publishChannel)}</span>
                    <span aria-hidden="true">•</span>
                    <span>{propertyFilePriceLabel(detail)}</span>
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="بستن جزئیات فایل"
              className="rounded-lg p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {detailLoading && (
              <div className="py-10 text-center text-sm text-muted-foreground">در حال دریافت جزئیات…</div>
            )}
            {detailError && (
              <div role="alert" className="rounded-xl border border-red-200 dark:border-red-500/35 bg-red-50 dark:bg-red-500/12 p-4 text-sm text-red-700 dark:text-red-300">
                <p>{detailError}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Btn type="button" variant="secondary" size="sm" onClick={() => setDetailRevision((value) => value + 1)}>
                    تلاش دوباره
                  </Btn>
                  <Btn type="button" variant="secondary" size="sm" onClick={refreshResults}>
                    <RefreshCw size={13} />
                    به‌روزرسانی نتایج
                  </Btn>
                </div>
              </div>
            )}
            {detail && !detailLoading && (
              <div className="space-y-5">
                {detail.property_detail?.image_url && (
                  <img
                    src={detail.property_detail.image_url}
                    alt=""
                    loading="lazy"
                    className="h-48 w-full rounded-2xl object-cover"
                  />
                )}

                <section className="rounded-2xl border border-border bg-secondary/20 p-4">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
                    <Building2 size={15} className="text-primary" />
                    ملک و قیمت
                  </h3>
                  <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">کد ملک</dt>
                      <dd className="mt-1 font-semibold">{detail.property_detail?.internal_code || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">متراژ</dt>
                      <dd className="mt-1 font-semibold">
                        {detail.area ? `${detail.area.toLocaleString("fa-IR")} متر` : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">نوع ملک</dt>
                      <dd className="mt-1 font-semibold">{detail.propertyType || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">طبقه</dt>
                      <dd className="mt-1 font-semibold">
                        {detail.property_detail?.floor != null ? detail.property_detail.floor.toLocaleString("fa-IR") : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">محله / شهر</dt>
                      <dd className="mt-1 font-semibold">
                        {[detail.district, detail.city].filter(Boolean).join("، ") || "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">نوع معامله</dt>
                      <dd className="mt-1 font-semibold">
                        {detail.dealTypeDisplay || toPersianDeal(detail.dealTypeName) || "—"}
                      </dd>
                    </div>
                  </dl>
                  {detailPriceParts.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                      {detailPriceParts.map((part) => (
                        <span key={part.label} className="rounded-full bg-card px-3 py-1 text-xs font-semibold">
                          {part.label}: {fmtShort(part.value)}
                        </span>
                      ))}
                    </div>
                  )}
                </section>

                {detailSpecs.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-sm font-bold">مشخصات ثبت‌شده</h3>
                    <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                      {detailSpecs.map((attribute) => (
                        <div key={attribute.name} className="rounded-xl border border-border bg-card px-3 py-2">
                          <dt className="text-muted-foreground">{attribute.displayName}</dt>
                          <dd className="mt-1 font-semibold">{attributeText(attribute)}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )}

                {detailFacilities.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-sm font-bold">امکانات</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {detailFacilities.map((attribute) => (
                        <span key={attribute.name} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                          {attribute.displayName}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {detail.description && (
                  <section>
                    <h3 className="mb-2 text-sm font-bold">توضیحات فایل</h3>
                    <p className="whitespace-pre-line text-xs leading-6 text-muted-foreground">{detail.description}</p>
                  </section>
                )}

                <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2">
                    <UserRound size={15} className="text-primary" />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                      {detail.consultantName || "کارشناس ثبت نشده"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">کارشناس مسئول</span>
                  </div>
                  <div className="rounded-2xl border border-border bg-card px-3 py-2 text-xs">
                    <span className="text-muted-foreground">انتشار: </span>
                    <span className="font-semibold">
                      {detail.start_date ? formatJalaliDT(detail.start_date) : formatJalaliDT(detail.created_at)}
                    </span>
                    {detail.end_date && (
                      <>
                        <span className="text-muted-foreground"> تا </span>
                        <span className="font-semibold">{formatJalaliDT(detail.end_date)}</span>
                      </>
                    )}
                  </div>
                </section>

                {ticketNumber ? (
                  <section className="rounded-2xl border border-emerald-200 dark:border-emerald-500/35 bg-emerald-50 dark:bg-emerald-500/12 p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 size={18} className="mt-0.5 text-emerald-700 dark:text-emerald-300" />
                      <div className="text-xs leading-6 text-emerald-900 dark:text-emerald-200">
                        <p className="text-sm font-bold">استعلام برای کارشناس مسئول ثبت شد</p>
                        {ticketNumber && (
                          <p className="mt-1">
                            شماره پیگیری: <span className="font-mono font-semibold">{ticketNumber}</span>
                          </p>
                        )}
                        <p className="mt-1">پاسخ کارشناس در بخش تیکت‌های شما نمایش داده می‌شود.</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Btn variant="secondary" size="sm" onClick={() => navigate("tickets-sent")}>
                        <FileText size={13} />
                        مشاهده تیکت‌های ارسال‌شده
                      </Btn>
                      <Btn variant="secondary" size="sm" onClick={onClose}>بستن</Btn>
                    </div>
                  </section>
                ) : (
                  <form onSubmit={submitInquiry} className="rounded-2xl border border-border bg-card p-4">
                    <h3 className="text-sm font-bold">معرفی / استعلام به مشتری</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      مشخصات مشتری را وارد کنید؛ یک تیکت درخواست برای کارشناس مسئول فایل
                      ({detail.consultantName || "ثبت نشده"}) ساخته می‌شود.
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        نام مشتری
                        <input
                          value={inquiry.clientName}
                          onChange={(event) => setInquiry((current) => ({ ...current, clientName: event.target.value }))}
                          maxLength={120}
                          placeholder="نام و نام خانوادگی مشتری"
                          className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                        />
                      </label>
                      <label className="text-xs font-medium text-muted-foreground">
                        شماره تماس مشتری
                        <input
                          value={inquiry.clientPhone}
                          onChange={(event) => setInquiry((current) => ({ ...current, clientPhone: event.target.value }))}
                          maxLength={40}
                          inputMode="tel"
                          placeholder="۰۹۱۲…"
                          className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                        />
                      </label>
                    </div>
                    <label className="mt-3 block text-xs font-medium text-muted-foreground">
                      یادداشت برای کارشناس مسئول
                      <textarea
                        value={inquiry.message}
                        onChange={(event) => setInquiry((current) => ({ ...current, message: event.target.value }))}
                        rows={3}
                        placeholder="نیاز مشتری، زمان پیشنهادی بازدید یا هر توضیح لازم"
                        className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                      />
                    </label>
                    {inquiryError && (
                      <div role="alert" className="mt-3 rounded-xl border border-red-200 dark:border-red-500/35 bg-red-50 dark:bg-red-500/12 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                        {inquiryError}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Btn type="submit" size="sm" disabled={inquirySending}>
                        <Send size={13} />
                        {inquirySending ? "در حال ارسال…" : "ثبت و ارسال به کارشناس"}
                      </Btn>
                      {detail.isMine && (
                        <Btn variant="secondary" size="sm" onClick={() => navigate("property-file-detail", detail.id)}>
                          <FileText size={13} />
                          صفحه فایل من
                        </Btn>
                      )}
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

export { PropertyFileDetailModal };
