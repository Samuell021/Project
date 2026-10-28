import React from "react";

export function Shell({ title, subtitle, children, error, loading, onReload, embedded = false, fill = false, eyebrow = "گروه سرمایه‌گذاری کلان فردا · Crm", actions }: { title: string; subtitle?: string; children: React.ReactNode; error?: string; loading?: boolean; onReload?: () => void; embedded?: boolean; fill?: boolean; eyebrow?: string; actions?: React.ReactNode }) {
  return (
    // `fill` makes the page own the viewport height instead of growing the document, so a
    // board inside it can scroll on its own axes (used by the operations pipeline). `overflow-hidden`
    // guarantees the page can never spill into the shell's scroll container: without it a fixed
    // minimum or an oversized block added a second scrollbar at the bottom of the page.
    <div className={embedded ? "w-full space-y-4" : fill ? "mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col overflow-hidden p-4 md:p-6" : "mx-auto w-full max-w-7xl p-4 md:p-6"} dir="rtl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 shrink-0">
        <div>
          <div className="text-[11px] font-medium tracking-wide text-muted-foreground">{eyebrow}</div>
          {embedded ? (
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
          ) : (
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          )}
          {subtitle ? <p className="mt-1 text-xs md:text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {onReload ? <button type="button" onClick={onReload} className="rounded-xl border px-3.5 py-1.5 text-xs md:text-sm hover:bg-secondary transition-colors">تازه‌سازی</button> : null}
        </div>
      </div>
      {error ? (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-red-50 dark:bg-red-500/12 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <span>{error}</span>
          {onReload ? <button type="button" onClick={onReload} className="rounded-lg border border-red-300 px-2 py-1 text-xs dark:border-red-500/40">تلاش دوباره</button> : null}
        </div>
      ) : null}
      {loading ? (
        <div role="status" aria-live="polite" className="space-y-3">
          <span className="sr-only">در حال دریافت اطلاعات</span>
          {[0, 1, 2].map((row) => <div key={row} className="h-16 animate-pulse rounded-2xl border bg-surface-muted" />)}
        </div>
      ) : children}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border bg-card p-4 shadow-sm ${className}`}>{children}</div>;
}

export function Btn({ children, onClick, color = "primary", type = "button", disabled = false, ariaExpanded }: { children: React.ReactNode; onClick?: () => void; color?: string; type?: "button" | "submit"; disabled?: boolean; ariaExpanded?: boolean }) {
  const styles: Record<string, string> = {
    primary: "bg-emerald-700 text-white hover:bg-emerald-800",
    light: "border bg-card text-foreground hover:bg-secondary",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  // `inline-flex` keeps an icon and its label on one line: Tailwind's preflight renders `svg` as a
  // block element, so a plain button stacked every icon above its title.
  return <button type={type} onClick={onClick} disabled={disabled} aria-expanded={ariaExpanded} className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium ${styles[color] || styles.primary} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}>{children}</button>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block text-muted-foreground">{label}</span>{children}</label>;
}

export const inputCls = "w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-emerald-600 bg-background";

export function SearchBar({ value, onChange, placeholder = "جست‌وجو در این فهرست…", flush = false }: { value: string; onChange: (value: string) => void; placeholder?: string; flush?: boolean }) {
  // The bottom margin belongs to a stacked layout only. Inside a `flex items-center` toolbar it
  // shifted the field upwards and broke its alignment with the button beside it, so those toolbars
  // ask for `flush` and own the spacing themselves.
  return (
    <div className={`max-w-xl ${flush ? "" : "mb-4"}`}>
      <label className="sr-only">جست‌وجو</label>
      <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={inputCls} />
    </div>
  );
}
