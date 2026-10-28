import React, { useEffect, useRef, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { apiErrorMessage, apiFetch, readJson } from "../../../shared/lib/apiClient";
import { toast } from "../../../shared/lib/utils";
import { Btn } from "../../../shared/components/ui/Btn";

function PropertyTicketForm({
  propertyId,
  csrfToken,
  onCreated,
  onCancel,
  onSubmittingChange,
  autoFocus = false,
}: {
  propertyId: string | number;
  csrfToken?: string;
  onCreated?: () => void;
  onCancel?: () => void;
  onSubmittingChange?: (submitting: boolean) => void;
  autoFocus?: boolean;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) messageRef.current?.focus();
  }, [autoFocus]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = message.trim();
    if (!body) {
      setError("متن تیکت الزامی است.");
      messageRef.current?.focus();
      return;
    }

    setError(null);
    setSubmitting(true);
    onSubmittingChange?.(true);
    try {
      const response = await apiFetch(
        "/tickets/api/tickets/",
        {
          method: "POST",
          body: JSON.stringify({
            ticketType: "REQUEST",
            priority: "NORMAL",
            subjectType: "PROPERTY",
            subjectId: propertyId,
            message: body,
          }),
        },
        csrfToken,
      );
      const data = await readJson(response);
      if (!response.ok) throw new Error(apiErrorMessage(data, "ثبت تیکت انجام نشد."));
      toast({
        type: "success",
        message: data?.ticketNumber
          ? `تیکت ${data.ticketNumber} برای کارشناس مسئول ملک ثبت شد.`
          : "تیکت برای کارشناس مسئول ملک ثبت شد.",
      });
      setMessage("");
      onCreated?.();
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : "ثبت تیکت انجام نشد.");
    } finally {
      setSubmitting(false);
      onSubmittingChange?.(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-xl border border-primary/15 bg-primary/5 px-3 py-2.5 text-xs leading-6 text-muted-foreground">
        این درخواست به‌صورت خودکار برای کارشناس مسئول ملک فرستاده می‌شود. نوع تیکت «درخواست» و اولویت «عادی» است.
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="property-ticket-message" className="text-sm font-medium text-foreground">
          متن تیکت <span className="text-primary mr-1">*</span>
        </label>
        <textarea
          ref={messageRef}
          id="property-ticket-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={5}
          maxLength={10000}
          required
          aria-invalid={Boolean(error)}
          className="w-full resize-y rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-primary/30"
          placeholder="درخواست خود درباره این ملک را بنویسید…"
        />
        <span className="text-left text-[11px] text-muted-foreground">{message.length.toLocaleString("fa-IR")} / ۱۰٬۰۰۰</span>
      </div>
      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && <Btn variant="secondary" type="button" onClick={onCancel} disabled={submitting}>انصراف</Btn>}
        <Btn variant="primary" type="submit" disabled={submitting || !message.trim()}>
          <MessageSquare size={13} />{submitting ? "در حال ارسال…" : "ارسال تیکت"}
        </Btn>
      </div>
    </form>
  );
}

function PropertyTicketModal({
  propertyId,
  propertyTitle,
  csrfToken,
  onClose,
  onCreated,
}: {
  propertyId: string | number;
  propertyTitle: string;
  csrfToken?: string;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, submitting]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="property-ticket-title" className="w-full max-w-lg bg-card rounded-2xl border border-border shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 p-5 border-b border-border">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              <MessageSquare size={17} />
            </span>
            <div>
              <h2 id="property-ticket-title" className="text-base font-semibold">ثبت تیکت برای ملک</h2>
              <p className="text-xs text-muted-foreground mt-1">{propertyTitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="بستن" className="p-1.5 hover:bg-secondary rounded-lg transition-colors disabled:opacity-50">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">
          <PropertyTicketForm
            propertyId={propertyId}
            csrfToken={csrfToken}
            autoFocus
            onSubmittingChange={setSubmitting}
            onCreated={onCreated ?? onClose}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  );
}

export { PropertyTicketForm, PropertyTicketModal };
