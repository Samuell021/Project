import React, { useEffect, useRef, useState } from "react";
import { Btn } from "./ui/Btn";
import { Check, X } from "lucide-react";

function ReviewReasonModal({
  title,
  description,
  submitLabel,
  busy = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  submitLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const normalizedReason = reason.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-reason-title"
        aria-describedby="review-reason-description"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="review-reason-title" className="text-base font-semibold">{title}</h2>
            <p id="review-reason-description" className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="بستن پنجره"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>
        <label htmlFor="review-reason" className="mt-5 block text-sm font-medium">دلیل بازگرداندن</label>
        <textarea
          ref={inputRef}
          id="review-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value.slice(0, 1000))}
          maxLength={1000}
          rows={5}
          required
          aria-required="true"
          aria-describedby="review-reason-help review-reason-count"
          className="mt-2 w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          placeholder="شرح دهید چه مواردی باید اصلاح شوند."
        />
        <div className="mt-1 flex items-center justify-between gap-3">
          <p id="review-reason-help" className="text-xs text-muted-foreground">این توضیح برای کارشناس نمایش داده می‌شود.</p>
          <span id="review-reason-count" className="text-xs tabular-nums text-muted-foreground">{reason.length.toLocaleString("fa-IR")} از ۱۰۰۰</span>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="secondary" size="sm" onClick={onCancel} disabled={busy}>انصراف</Btn>
          <Btn
            variant="primary"
            size="sm"
            onClick={() => void onConfirm(normalizedReason)}
            disabled={busy || normalizedReason.length === 0}
          >
            <Check size={13} />
            {busy ? "در حال ثبت…" : submitLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
}

export { ReviewReasonModal };
