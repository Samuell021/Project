import { useMemo, useState } from "react";
import { useLoad } from "../lib/useCrmLoad";
import { post } from "../lib/crmApi";
import { emitSupplyCountersRefresh } from "../lib/supplyDomain";
import { Shell, Card, Btn, Field, inputCls, SearchBar } from "../components/CrmUIKit";
import type { Row, CrmNavigate } from "../types";

const INBOX_KIND_LABELS: Record<string, string> = {
  LEAD_ACCEPTANCE: "در انتظار پذیرش سرنخ",
  ASSIGNMENT_ACCEPTANCE: "در انتظار پذیرش مسئول",
  WITHDRAWAL_REVIEW: "بررسی درخواست انصراف",
  EXTENSION_REVIEW: "بررسی درخواست تمدید",
};

export function Inbox({ csrfToken, navigate }: { csrfToken: string; navigate: CrmNavigate }) {
  const [search, setSearch] = useState("");
  const query = encodeURIComponent(search.trim());
  const urls = useMemo(
    () => [`/crm/api/property-cases/inbox/?search=${query}`, `/crm/api/inquiries/inbox/?search=${query}`],
    [query],
  );
  const { data, error, loading, reload } = useLoad(urls, csrfToken);
  const [msg, setMsg] = useState("");
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});

  async function act(url: string, body: Row = {}) {
    try {
      await post(csrfToken, url, body);
      setMsg("عملیات با موفقیت انجام شد.");
      reload();
      emitSupplyCountersRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "خطا در انجام عملیات");
    }
  }

  const groups: [string, Row[], string][] = [
    ["پرونده‌های ملک", (data[urls[0]] as Row[] | undefined) || [], "/crm/api/property-cases/"],
    ["درخواست‌های متقاضی", (data[urls[1]] as Row[] | undefined) || [], "/crm/api/inquiries/"],
  ];

  return (
    <Shell
      title="کارتابل پذیرش"
      subtitle="پذیرش مدیر، پذیرش مسئول، انصراف و تمدید به‌صورت تفکیک‌شده مدیریت می‌شوند."
      error={error}
      loading={loading && !Object.keys(data).length}
      onReload={reload}
    >
      {msg ? (
        <div role="status" className="mb-4 rounded-xl bg-surface-muted px-4 py-3 text-sm">
          {msg}
        </div>
      ) : null}
      <SearchBar value={search} onChange={setSearch} placeholder="جست‌وجو در کارتابل بر اساس کد، شخص یا مسئول…" />
      <div className="space-y-6">
        {groups.map(([title, rows, base]) => (
          <section key={title}>
            <h2 className="mb-3 font-bold">{title}</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((r) => {
                const reasonKey = String(r.workflow_request_id ?? `row-${r.id}`);
                const reasonVal = decisionReasons[reasonKey] || "";
                const kindLabel = INBOX_KIND_LABELS[String(r.inbox_kind)] || String(r.inbox_kind || "");
                return (
                  <Card key={`${r.id}-${r.inbox_kind}`}>
                    <div className="flex justify-between gap-2">
                      <strong>{r.code}</strong>
                      <span className="rounded-full bg-emerald-50 dark:bg-emerald-500/12 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                        {kindLabel}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      {r.contact_name} {r.property_title ? `· ${r.property_title}` : ""}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      مسئول: {r.assigned_to_name || "نامشخص"} · موعد:{" "}
                      {r.due_at ? new Date(r.due_at).toLocaleString("fa-IR") : "نامشخص"}
                    </div>

                    {r.inbox_kind === "ASSIGNMENT_ACCEPTANCE" ? (
                      <div className="mt-3">
                        <Field label="علت رد ارجاع (در صورت نپذیرفتن)">
                          <input
                            value={reasonVal}
                            onChange={(event) =>
                              setDecisionReasons((current) => ({ ...current, [reasonKey]: event.target.value }))
                            }
                            placeholder="در صورت رد ارجاع دلیل را بنویسید"
                            className={inputCls}
                          />
                        </Field>
                      </div>
                    ) : null}

                    {r.inbox_kind === "WITHDRAWAL_REVIEW" || r.inbox_kind === "EXTENSION_REVIEW" ? (
                      <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/5">
                        <p className="text-xs text-muted-foreground">
                          درخواست مسئول: {r.request_reason || "بدون توضیح"}
                          {r.requested_due_at
                            ? ` · موعد پیشنهادی: ${new Date(r.requested_due_at).toLocaleString("fa-IR")}`
                            : ""}
                        </p>
                        <Field label="دلیل تصمیم">
                          <input
                            value={reasonVal}
                            onChange={(event) =>
                              setDecisionReasons((current) => ({ ...current, [reasonKey]: event.target.value }))
                            }
                            className={inputCls}
                          />
                        </Field>
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {r.inbox_kind === "LEAD_ACCEPTANCE" ? (
                        <Btn onClick={() => act(`${base}${r.id}/accept_lead/`)}>پذیرش سرنخ</Btn>
                      ) : null}
                      {r.inbox_kind === "ASSIGNMENT_ACCEPTANCE" ? (
                        <>
                          <Btn onClick={() => act(`${base}${r.id}/accept_assignment/`)}>پذیرش ارجاع</Btn>
                          {!base.includes("inquiries") ? (
                            <Btn
                              color="light"
                              onClick={() => {
                                if (!reasonVal.trim()) {
                                  setMsg("برای رد ارجاع، ثبت علت الزامی است.");
                                  return;
                                }
                                void act(`${base}${r.id}/reject_assignment/`, { reason: reasonVal.trim() });
                              }}
                            >
                              رد ارجاع
                            </Btn>
                          ) : null}
                        </>
                      ) : null}
                      {r.inbox_kind === "WITHDRAWAL_REVIEW" ? (
                        <>
                          <Btn
                            onClick={() =>
                              act(`/crm/api/withdrawals/${r.workflow_request_id}/decide/`, {
                                approve: true,
                                reason: reasonVal,
                              })
                            }
                          >
                            تأیید انصراف
                          </Btn>
                          <Btn
                            color="light"
                            onClick={() =>
                              act(`/crm/api/withdrawals/${r.workflow_request_id}/decide/`, {
                                approve: false,
                                reason: reasonVal,
                              })
                            }
                          >
                            رد انصراف
                          </Btn>
                        </>
                      ) : null}
                      {r.inbox_kind === "EXTENSION_REVIEW" ? (
                        <>
                          <Btn
                            onClick={() =>
                              act(`/crm/api/reschedules/${r.workflow_request_id}/decide/`, {
                                approve: true,
                                reason: reasonVal,
                              })
                            }
                          >
                            تأیید تمدید
                          </Btn>
                          <Btn
                            color="light"
                            onClick={() =>
                              act(`/crm/api/reschedules/${r.workflow_request_id}/decide/`, {
                                approve: false,
                                reason: reasonVal,
                              })
                            }
                          >
                            رد تمدید
                          </Btn>
                        </>
                      ) : null}
                      <Btn
                        color="light"
                        onClick={() => navigate(base.includes("inquiries") ? "crm-inquiries" : "crm-property-cases", r.id)}
                      >
                        باز کردن پرونده
                      </Btn>
                    </div>
                  </Card>
                );
              })}
              {!rows.length ? <Card>موردی در این بخش نیست.</Card> : null}
            </div>
          </section>
        ))}
      </div>
    </Shell>
  );
}
