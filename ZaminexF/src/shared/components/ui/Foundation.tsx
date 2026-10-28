import React, { useId, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, Check, Minus, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { Btn } from "./Btn";
import { cx } from "../../lib/utils";

export function FormField({ label, error, children, htmlFor }: { label: string; error?: string; children: React.ReactNode; htmlFor?: string }) {
  return <div className="space-y-1.5"><label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">{label}</label>{children}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</div>;
}

export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>;
}

export function TextField({ label, error, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const id = useId();
  return <FormField label={label} error={error} htmlFor={id}><input {...props} id={id} aria-invalid={Boolean(error)} className="w-full rounded-xl border border-border bg-input-background text-foreground px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" /></FormField>;
}

export function SearchInput({ value, onChange, label = "جست‌وجو" }: { value: string; onChange: (value: string) => void; label?: string }) {
  return <label className="relative block flex-1 min-w-0"><span className="sr-only">{label}</span><Search size={16} className="absolute right-3 top-3 text-muted-foreground" /><input type="search" aria-label={label} placeholder={label} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-border bg-input-background text-foreground pr-10 pl-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></label>;
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div role="search" className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 mb-4">{children}</div>;
}

export function Skeleton({ label = "در حال دریافت اطلاعات" }: { label?: string }) {
  return <div role="status" aria-label={label} className="space-y-3 py-4"><span className="sr-only">{label}</span>{[0, 1, 2].map((key) => <div key={key} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>;
}

export function ResourceError({ error, forbidden, retry }: { error: string; forbidden?: boolean; retry: () => void }) {
  return <div role="alert" className="rounded-xl border border-border bg-card p-6 space-y-3 text-foreground"><AlertCircle className="text-destructive" size={24} /><h2 className="font-semibold">{forbidden ? "دسترسی مجاز نیست" : "دریافت اطلاعات انجام نشد"}</h2><p className="text-sm text-muted-foreground">{error}</p>{!forbidden && <Btn variant="secondary" onClick={retry}>تلاش دوباره</Btn>}</div>;
}

export function Pagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <nav aria-label="صفحه‌بندی" className="flex flex-wrap items-center justify-between gap-3 mt-4 text-sm text-muted-foreground"><span>{total.toLocaleString("fa-IR")} مورد · صفحه {page.toLocaleString("fa-IR")} از {pages.toLocaleString("fa-IR")}</span><div className="flex gap-2"><Btn variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronRight size={16} />قبلی</Btn><Btn variant="secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>بعدی<ChevronLeft size={16} /></Btn></div></nav>;
}

export type TableColumn<T> = { key: string; label: string; render: (row: T) => React.ReactNode };
export function DataTable<T extends { id: number | string }>({ rows, columns, caption }: { rows: T[]; columns: TableColumn<T>[]; caption: string }) {
  return <><div className="hidden md:block overflow-x-auto rounded-xl border border-border"><table className="w-full text-right text-sm"><caption className="sr-only">{caption}</caption><thead className="bg-muted text-muted-foreground"><tr>{columns.map((column) => <th key={column.key} scope="col" className="p-3 font-medium">{column.label}</th>)}</tr></thead><tbody className="bg-card">{rows.map((row) => <tr key={row.id} className="border-t border-border">{columns.map((column) => <td key={column.key} className="p-3 text-foreground">{column.render(row)}</td>)}</tr>)}</tbody></table></div><div className="grid gap-3 md:hidden" aria-label={caption}>{rows.map((row) => <dl key={row.id} className="rounded-xl border border-border bg-card p-4 space-y-3">{columns.map((column) => <div key={column.key} className="flex justify-between gap-3"><dt className="text-xs text-muted-foreground">{column.label}</dt><dd className="text-sm text-foreground break-words min-w-0">{column.render(row)}</dd></div>)}</dl>)}</div></>;
}

export function Modal({ open, onClose, title, children, drawer = false }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; drawer?: boolean }) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return <Dialog.Root open={open} onOpenChange={(value) => { if (!value) onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/30" /><Dialog.Content onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus(); }} aria-describedby={undefined} className={cx("fixed z-50 bg-card border border-border shadow-xl p-5 overflow-y-auto max-h-[90dvh] focus:outline-none text-foreground", drawer ? "inset-y-0 right-0 w-full sm:max-w-lg max-h-dvh" : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%_-_2rem)] max-w-xl rounded-2xl")} dir="rtl"><div className="flex items-center justify-between gap-3 mb-5"><Dialog.Title className="font-bold">{title}</Dialog.Title><Dialog.Close aria-label="بستن" className="rounded-lg p-2 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><X size={18} /></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export function Drawer(props: Omit<React.ComponentProps<typeof Modal>, "drawer">) {
  return <Modal {...props} drawer />;
}

export function StatusPill({ label, active }: { label: string; active?: boolean }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs", active ? "border-primary text-primary" : "border-border text-muted-foreground")}><span aria-hidden="true">{active ? <Check size={12} /> : <Minus size={12} />}</span>{label}</span>;
}

export function Tabs({ value, tabs, onChange }: { value: string; tabs: { key: string; label: string }[]; onChange: (key: string) => void }) {
  return <div role="tablist" aria-label="نماهای صفحه" className="flex flex-wrap gap-2 border-b border-border mb-4 pb-2">{tabs.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={value === tab.key} onClick={() => onChange(tab.key)} className={cx("px-3 py-2 rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring", value === tab.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>{tab.label}</button>)}</div>;
}
