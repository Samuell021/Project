import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Columns3, Filter, GripVertical, Loader2, MoveRight, User, Users } from "lucide-react";
import { Badge } from "../../../shared/components/ui/Badge";
import { EmptyState } from "../../../shared/components/ui/EmptyState";
import { Skeleton } from "../../../shared/components/ui/Foundation";
import { usePermissions } from "../../../shared/lib/permissions";
import { usePageQuery } from "../../../shared/lib/pageQuery";
import { Btn, Card, Field, Shell, inputCls } from "../components/CrmUIKit";
import { patch, post } from "../lib/crmApi";
import { useLoad } from "../lib/useCrmLoad";
import {
  blockedReason,
  boardQuery,
  transitionFor,
  type PipelineBoard,
  type PipelineCard,
  type PipelineColumn,
  type PipelineFilters,
} from "../lib/pipelineDomain";
import type { CrmNavigate, Row } from "../types";
import type { Role } from "../../../shared/lib/types";

// Reference lookups of the toolbar. The staff list is a management surface: the server refuses
// it to a consultant, so a consultant's board simply leaves it out.
const STAFF_URL = "/crm/api/staff/?page_size=200";
const SCOPES_URL = "/crm/api/scopes/?page_size=100";
const DEAL_TYPES_URL = "/crm/api/deal-types/?page_size=100";

const FILTER_DEFAULT: PipelineFilters = {
  search: "",
  assignee: "",
  scope: "",
  deal_type: "",
  priority: "",
  view: "team",
  unassigned: false,
  overdue: false,
};

function faDate(value: string | null): string {
  if (!value) return "بدون موعد";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "بدون موعد" : parsed.toLocaleDateString("fa-IR");
}

export function Pipelines({ csrfToken, navigate, role }: { csrfToken: string; navigate: CrmNavigate; role?: Role }) {
  const { query, update } = usePageQuery();
  const { can } = usePermissions();
  // A consultant reaches the same board, narrowed by the server to their own records: the
  // supervisor controls (staff list, team/mine switch) are neither available nor meaningful.
  const ownBoardOnly = role === "consultant";
  const kind = query.get("kind") || "leads";
  const [filters, setFilters] = useState<PipelineFilters>({
    ...FILTER_DEFAULT,
    search: query.get("search") || "",
    assignee: query.get("assignee") || "",
    scope: query.get("scope") || "",
    deal_type: query.get("deal_type") || "",
    priority: query.get("priority") || "",
    view: query.get("mine") === "1" ? "mine" : "team",
    unassigned: query.get("unassigned") === "1",
    overdue: query.get("overdue") === "1",
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [dragCard, setDragCard] = useState<PipelineCard | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const queryString = useMemo(() => boardQuery(filters), [filters]);
  const boardUrl = `/crm/api/pipelines/${kind}/${queryString ? `?${queryString}` : ""}`;
  const referenceUrls = useMemo(
    () => (ownBoardOnly ? [SCOPES_URL, DEAL_TYPES_URL] : [STAFF_URL, SCOPES_URL, DEAL_TYPES_URL]),
    [ownBoardOnly],
  );
  const urls = useMemo(() => [boardUrl, ...referenceUrls], [boardUrl, referenceUrls]);
  const { data, error, loading, reload } = useLoad(urls, csrfToken);
  // Only a payload that actually carries stages is a board; anything else keeps the empty state
  // instead of rendering an undefined column list.
  const boardPayload = data[boardUrl] as PipelineBoard | undefined;
  const board = boardPayload && Array.isArray(boardPayload.stages) ? boardPayload : null;
  const staff: Row[] = ownBoardOnly ? [] : ((data[STAFF_URL] || []) as Row[]);
  const scopes: Row[] = (data[SCOPES_URL] || []) as Row[];
  const dealTypes: Row[] = (data[DEAL_TYPES_URL] || []) as Row[];

  useEffect(() => {
    update(
      {
        search: filters.search.trim() || null,
        assignee: filters.assignee || null,
        scope: filters.scope || null,
        deal_type: filters.deal_type || null,
        priority: filters.priority || null,
        mine: filters.view === "mine" ? "1" : null,
        unassigned: filters.unassigned ? "1" : null,
        overdue: filters.overdue ? "1" : null,
      },
      true,
    );
  }, [kind, filters, update]);

  useEffect(() => {
    if (!board || board.kind === kind) return;
    update({ kind: board.kind === "leads" ? null : board.kind }, true);
  }, [board, kind, update]);

  async function execute(card: PipelineCard, transition: ReturnType<typeof transitionFor>, reason: string) {
    if (!transition) return;
    setBusy(`card-${card.id}`);
    setMessage("");
    try {
      if (transition.method === "PATCH") {
        await patch(csrfToken, transition.endpoint, { ...(transition.payload || {}) });
      } else {
        await post(csrfToken, transition.endpoint, { ...(transition.payload || {}), ...(reason ? { reason } : {}) });
      }
      setMessage(`«${card.title}» به مرحله «${transition.label}» منتقل شد.`);
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "انتقال انجام نشد.");
    } finally {
      setBusy("");
    }
  }

  function handleDrop(column: PipelineColumn) {
    if (!dragCard) return;
    const transition = transitionFor(dragCard, column.code);
    const reason = blockedReason(transition, column.label);
    if (reason) {
      setMessage(reason);
      setDragCard(null);
      return;
    }
    if (transition?.reason_required) {
      setMessage("این انتقال دلیل می‌خواهد؛ از گزینه «تغییر مرحله» در کارت، دلیل را وارد کنید.");
      setDragCard(null);
      return;
    }
    void execute(dragCard, transition, "");
    setDragCard(null);
  }

  function availableTransitions(card: PipelineCard) {
    return card.transitions.filter((transition) => !transition.requires || transition.requires.length === 0);
  }

  return (
    <Shell
      title="کاریز عملیات"
      subtitle={ownBoardOnly
        ? "این کاریز فقط رکوردهای خود شما را نشان می‌دهد؛ جابه‌جایی کارت همان فرمان صفحه رکورد را اجرا می‌کند و انتقال نامجاز رد می‌شود."
        : "هر کارت یک رکورد واقعی است؛ جابه‌جایی کارت همان فرمان صفحه رکورد را اجرا می‌کند و انتقال نامجاز رد می‌شود."}
      error={error}
      loading={false}
      fill
      onReload={reload}
    >
      <div role="status" aria-live="polite" className={message ? "mb-3 shrink-0 rounded-xl bg-surface-muted px-4 py-2 text-sm" : "sr-only"}>{message}</div>

      <div role="tablist" aria-label="انتخاب کاریز" className="mb-3 flex shrink-0 flex-wrap gap-2">
        {(board?.available || []).map((item) => (
          <button
            key={item.kind}
            role="tab"
            type="button"
            aria-selected={kind === item.kind}
            onClick={() => update({ kind: item.kind === "leads" ? null : item.kind })}
            className={`rounded-xl px-3 py-1.5 text-sm ${kind === item.kind ? "bg-emerald-700 text-white" : "border bg-card hover:bg-secondary"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <Card className="mb-4 shrink-0">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-full max-w-xs">
            <Field label="جست‌وجو">
              <input
                type="search"
                className={inputCls}
                value={filters.search}
                onChange={(event) => setFilters({ ...filters, search: event.target.value })}
                placeholder="کد، عنوان یا مسئول…"
              />
            </Field>
          </div>
          <Btn color="light" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}>
            <span className="inline-flex items-center gap-1.5"><Filter size={14} aria-hidden />فیلترها</span>
          </Btn>
          <div className="text-xs text-muted-foreground sm:mr-auto">
            {board ? `${board.total.toLocaleString("fa-IR")} رکورد · ${board.stalled.toLocaleString("fa-IR")} هشدار توقف (آستانه ${board.stall_threshold_days.toLocaleString("fa-IR")} روز)` : ""}
          </div>
          {/* The view switch is rendered last so the toolbar leaves it at the opposite (left) end.
              It belongs to a supervisor: a consultant's board is their own work, so both options
              would mean the same thing and the switch is left out. */}
          {ownBoardOnly ? null : (
            <div role="group" aria-label="نمای کاریز" className="inline-flex items-center gap-1 rounded-xl border border-border bg-card p-1">
              {(["team", "mine"] as const).map((mode) => {
                const active = filters.view === mode;
                const Icon = mode === "mine" ? User : Users;
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFilters({ ...filters, view: mode })}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-emerald-700 text-white shadow-sm" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
                  >
                    <Icon size={14} aria-hidden />
                    {mode === "mine" ? "من" : "تیم"}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {filtersOpen ? (
          <div className={`mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2 ${ownBoardOnly ? "xl:grid-cols-4" : "xl:grid-cols-5"}`}>
            {/* A consultant cannot read the staff list (it is a management surface), and their
                board already holds only their own records, so the owner filter is left out. */}
            {ownBoardOnly ? null : (
              <Field label="مسئول">
                <select className={inputCls} value={filters.assignee} onChange={(event) => setFilters({ ...filters, assignee: event.target.value })}>
                  <option value="">همه مسئول‌ها</option>
                  {staff.map((member) => <option key={member.id} value={member.user_id || member.id}>{member.full_name || member.username || member.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="رنج">
              <select className={inputCls} value={filters.scope} onChange={(event) => setFilters({ ...filters, scope: event.target.value })}>
                <option value="">همه رنج‌های مجاز</option>
                {scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.name}</option>)}
              </select>
            </Field>
            <Field label="نوع معامله">
              <select className={inputCls} value={filters.deal_type} onChange={(event) => setFilters({ ...filters, deal_type: event.target.value })}>
                <option value="">همه انواع</option>
                {dealTypes.map((dealType) => <option key={dealType.id} value={dealType.id}>{dealType.display_name}</option>)}
              </select>
            </Field>
            <Field label="اولویت">
              <select className={inputCls} value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
                <option value="">همه اولویت‌ها</option>
                <option value="4">فوری</option>
                <option value="3">بالا</option>
                <option value="2">عادی</option>
                <option value="1">کم</option>
              </select>
            </Field>
            <div className="flex flex-col justify-end gap-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={filters.unassigned} onChange={(event) => setFilters({ ...filters, unassigned: event.target.checked })} /> فقط بدون مسئول</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={filters.overdue} onChange={(event) => setFilters({ ...filters, overdue: event.target.checked })} /> فقط عقب‌افتاده</label>
            </div>
          </div>
        ) : null}
      </Card>

      {loading && !board ? <Skeleton label="در حال دریافت کاریز" /> : null}
      {!loading && !board && error ? (
        <Card>
          <EmptyState icon={<AlertTriangle size={22} />} title="کاریز بارگذاری نشد" description="دسترسی خود را بررسی کنید یا دوباره تلاش کنید." action={<Btn color="light" onClick={reload}>تلاش دوباره</Btn>} />
        </Card>
      ) : null}

      {/* The board takes exactly the space that is left, never a fixed minimum: a hard floor made
          the page taller than the viewport (and the shell scroll alongside the columns) whenever
          the filter panel was open or the window was short. */}
      {board ? (
        <div className="flex min-h-0 flex-1 snap-x gap-3 overflow-x-auto overflow-y-hidden pb-3" dir="rtl">
          {board.stages.map((column) => (
            <section
              key={column.code}
              aria-label={`ستون ${column.label}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleDrop(column)}
              className="flex w-72 shrink-0 snap-start flex-col rounded-2xl bg-surface-muted p-3"
            >
              <header className="mb-3 flex shrink-0 items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-bold"><Columns3 size={14} aria-hidden />{column.label}</h3>
                <span className="rounded-full bg-card px-2 py-0.5 text-xs">{column.count.toLocaleString("fa-IR")}</span>
              </header>
              {column.cards.length === 0 ? (
                <p className="rounded-xl border border-dashed p-3 text-center text-xs text-muted-foreground">رکوردی در این مرحله نیست</p>
              ) : (
                <ul className="-mx-1 min-h-0 flex-1 space-y-2 overflow-y-auto px-1 pb-1">
                  {column.cards.map((card) => {
                    const transitions = availableTransitions(card);
                    return (
                      <li
                        key={`${kind}-${card.id}`}
                        draggable
                        onDragStart={() => setDragCard(card)}
                        onDragEnd={() => setDragCard(null)}
                        className={`rounded-xl border bg-card p-3 text-sm shadow-sm ${card.stalled ? "border-amber-400 dark:border-amber-500/60" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button type="button" className="text-right font-semibold hover:underline" onClick={() => navigate(card.record_page as never, card.id)}>
                            {card.title || card.code}
                          </button>
                          <GripVertical size={14} className="mt-0.5 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{card.code}{card.subtitle ? ` · ${card.subtitle}` : ""}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                          <Badge variant="muted" label={card.owner || "بدون مسئول"} />
                          <Badge variant={card.due_at ? "default" : "warning"} label={faDate(card.due_at)} />
                          {card.stalled ? <Badge variant="warning" label={`${card.days_in_stage.toLocaleString("fa-IR")} روز در مرحله`} /> : null}
                        </div>
                        {card.warnings.length > 0 ? (
                          <ul className="mt-2 space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
                            {card.warnings.map((warning) => <li key={warning} className="flex items-center gap-1"><AlertTriangle size={11} aria-hidden />{warning}</li>)}
                          </ul>
                        ) : null}
                        {transitions.length > 0 && can("case.view") ? (
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            <MoveRight size={12} className="text-muted-foreground" aria-hidden />
                            <label className="sr-only" htmlFor={`stage-${kind}-${card.id}`}>تغییر مرحله {card.code}</label>
                            <select
                              id={`stage-${kind}-${card.id}`}
                              className="rounded-lg border bg-background px-2 py-1 text-xs"
                              value=""
                              disabled={busy === `card-${card.id}`}
                              onChange={(event) => {
                                const transition = transitions.find((item) => item.to === event.target.value);
                                if (!transition) return;
                                if (transition.reason_required) {
                                  const reason = window.prompt(`دلیل انتقال به «${transition.label}» را وارد کنید.`);
                                  if (!reason || !reason.trim()) {
                                    setMessage("انتقال بدون دلیل رد شد.");
                                    return;
                                  }
                                  void execute(card, transition, reason.trim());
                                  return;
                                }
                                void execute(card, transition, "");
                              }}
                            >
                              <option value="">تغییر مرحله…</option>
                              {transitions.map((transition) => <option key={transition.to} value={transition.to}>{transition.label}</option>)}
                            </select>
                            {busy === `card-${card.id}` ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      ) : null}
    </Shell>
  );
}
