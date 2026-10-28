import { ChevronDown, Search, Check, Loader2, Phone, UserRound } from "lucide-react";
import React, { useState, useEffect, useRef, useMemo } from "react";
import { ProfileAvatar } from "./ProfileAvatar";
import { cx } from "../../lib/utils";
import { fuzzyFilter, normalizeText } from "../../lib/fuzzySearch";

export type ContactPhoneRow = {
  id?: number;
  phone?: string;
  normalized_phone?: string;
  label?: string;
  is_primary?: boolean;
};

export type ContactComboboxRow = {
  id: string | number;
  full_name?: string;
  name?: string;
  national_code?: string;
  phones?: ContactPhoneRow[];
  phone?: string;
  is_legacy_placeholder?: boolean;
};

export type ContactComboboxItem = {
  id: string;
  name: string;
  phone: string;
  nationalCode: string;
  searchText: string;
  avatar: string;
};

function contactName(row: ContactComboboxRow): string {
  const value = (row.full_name || row.name || "").toString();
  return value.replace(/\s+/g, " ").trim();
}

function contactPhone(row: ContactComboboxRow): string {
  const numbers = Array.isArray(row.phones) ? row.phones : [];
  const primary = numbers.find((item) => item?.is_primary) || numbers[0];
  const value = primary?.phone || primary?.normalized_phone || row.phone || "";
  return value.toString().trim();
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "؟";
}

/**
 * Turns the raw `/crm/api/contacts/` rows into the combobox list.
 *
 * The server keeps every person as its own record and never merges them, so the same person can
 * legitimately be stored twice (for example a lead registered twice with the same name and the
 * same number). The list collapses only entries that are indistinguishable — same name and same
 * number — so two different people who happen to share a name stay selectable, and the number is
 * always shown next to the name to tell them apart.
 */
export function buildContactItems(rows: ContactComboboxRow[] | null | undefined): ContactComboboxItem[] {
  const seen = new Set<string>();
  const items: ContactComboboxItem[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = contactName(row);
    if (!name) continue;
    const phone = contactPhone(row);
    const nationalCode = (row.national_code || "").toString().trim();
    const key = `${normalizeText(name)}|${normalizeText(phone)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: String(row.id),
      name,
      phone,
      nationalCode,
      searchText: [name, phone, nationalCode].filter(Boolean).join(" "),
      avatar: initialsOf(name),
    });
  }
  return items;
}

function ContactCombobox({
  value,
  onChange,
  contacts,
  label,
  required,
  disabled,
  loading,
  error,
  placeholder = "انتخاب شخص…",
}: {
  value: string;
  onChange: (v: string) => void;
  contacts: ContactComboboxRow[];
  label?: string;
  required?: boolean;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => buildContactItems(contacts), [contacts]);
  const selected = useMemo(() => items.find((item) => item.id === String(value)), [items, value]);
  const filtered = useMemo(() => fuzzyFilter(items, q, (item) => item.searchText), [items, q]);

  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 50);
      setFocused(0);
      return () => window.clearTimeout(id);
    }
    setQ("");
    return undefined;
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocused((previous) => Math.min(previous + 1, Math.max(0, filtered.length - 1)));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocused((previous) => Math.max(previous - 1, 0));
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const pick = filtered[focused];
      if (pick) {
        onChange(pick.id);
        setOpen(false);
      }
    }
    if (e.key === "Escape") setOpen(false);
  };

  const hl = (text: string) => {
    if (!q.trim() || !text) return <>{text}</>;
    const needle = q.trim().toLowerCase();
    const index = text.toLowerCase().indexOf(needle);
    if (index === -1) return <>{text}</>;
    return (
      <>
        {text.slice(0, index)}
        <mark className="bg-primary/20 text-primary rounded-sm not-italic">
          {text.slice(index, index + needle.length)}
        </mark>
        {text.slice(index + needle.length)}
      </>
    );
  };

  const secondary = (item: ContactComboboxItem) =>
    [item.phone || "بدون شماره", item.nationalCode ? `کد ملی ${item.nationalCode}` : ""]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="flex flex-col gap-1.5" ref={ref}>
      {label && (
        <label className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-primary mr-1">*</span>}
        </label>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={() => !disabled && setOpen(!open)}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cx(
            "w-full px-3 py-2 rounded-xl border border-border bg-card text-right text-sm flex items-center gap-2 justify-between transition-colors",
            disabled ? "opacity-60 cursor-not-allowed" : "hover:border-primary/30",
          )}
        >
          {selected ? (
            <>
              <ProfileAvatar initials={selected.avatar} size="xs" />
              <span className="flex-1 font-medium truncate">{selected.name}</span>
              <span className="text-xs text-muted-foreground truncate" dir="ltr">
                {selected.phone}
              </span>
            </>
          ) : (
            <span className="flex-1 text-muted-foreground">
              {loading ? "در حال بارگذاری اشخاص…" : placeholder}
            </span>
          )}
          <ChevronDown
            size={14}
            className={cx("text-muted-foreground transition-transform flex-shrink-0", open && "rotate-180")}
          />
        </button>

        {open && !disabled && (
          <div className="absolute z-50 w-full mt-1 bg-card rounded-xl border border-border shadow-lg overflow-hidden">
            <div className="p-2 border-b border-border">
              <div className="relative">
                <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setFocused(0);
                  }}
                  onKeyDown={handleKey}
                  placeholder="جستجوی نام، شماره تماس یا کد ملی…"
                  aria-label="جستجو در اشخاص"
                  className="w-full pr-8 pl-3 py-2 text-sm bg-secondary rounded-lg outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <div role="listbox" className="max-h-60 overflow-y-auto py-1">
              {loading ? (
                <p className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                  <Loader2 size={13} className="animate-spin" />
                  در حال بارگذاری اشخاص…
                </p>
              ) : filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  {items.length === 0 ? "شخصی در CRM ثبت نشده است" : "شخصی با این مشخصات یافت نشد"}
                </p>
              ) : (
                filtered.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={String(value) === item.id}
                    onMouseEnter={() => setFocused(index)}
                    onClick={() => {
                      onChange(item.id);
                      setOpen(false);
                    }}
                    className={cx(
                      "w-full flex items-center gap-3 px-3 py-2.5 text-right transition-colors",
                      index === focused ? "bg-secondary" : "hover:bg-secondary/50",
                    )}
                  >
                    <ProfileAvatar initials={item.avatar} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{hl(item.name)}</p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Phone size={10} className="flex-shrink-0" />
                        <span className="truncate" dir="ltr">
                          {hl(item.phone || "بدون شماره")}
                        </span>
                        {item.nationalCode ? (
                          <span className="truncate">· کد ملی {hl(item.nationalCode)}</span>
                        ) : null}
                      </p>
                    </div>
                    {String(value) === item.id && <Check size={13} className="text-primary flex-shrink-0" />}
                  </button>
                ))
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border bg-secondary/30 px-3 py-1.5 text-[11px] text-muted-foreground">
              <span>{filtered.length.toLocaleString("fa-IR")} شخص</span>
              <span className="flex items-center gap-1">
                <UserRound size={10} />
                ساخته‌شده در CRM
              </span>
            </div>
          </div>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export { ContactCombobox };
