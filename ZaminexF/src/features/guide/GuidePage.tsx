import { useState } from "react";
import { usePageQuery } from "../../shared/lib/pageQuery";
import { GUIDE_ENTITIES, GUIDE_FLOWS, GUIDE_PAGES, GUIDE_RULES } from "./guideContent";
import type { Page, Role } from "../../shared/lib/types";

type Props = {
  role: Role;
  navigate: (page: Page, id?: string | number) => void;
};

const TABS = [
  { key: "entities", label: "مدل‌ها و روابط" },
  { key: "flows", label: "جریان‌ها" },
  { key: "pages", label: "راهنمای صفحه‌به‌صفحه" },
  { key: "rules", label: "قواعد مشترک" },
];

export default function GuidePage({ navigate }: Props) {
  const { query, update } = usePageQuery();
  const initial = query.get("tab") || "entities";
  const [tab, setTab] = useState(TABS.some((item) => item.key === initial) ? initial : "entities");

  function selectTab(key: string) {
    setTab(key);
    update({ tab: key === "entities" ? null : key });
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-6" dir="rtl">
      <header className="mb-6">
        <div className="text-[11px] font-medium tracking-wide text-muted-foreground">گروه سرمایه‌گذاری کلان فردا · Crm</div>
        <h1 className="text-2xl font-bold text-foreground">راهنمای ساختار</h1>
        <p className="mt-1 text-xs text-muted-foreground md:text-sm">مرجع درون‌برنامه‌ای مدل‌ها، جریان‌ها، مالک هر صفحه و معیار پذیرش آن. محتوای این صفحه از یک فایل داده واحد تولید می‌شود.</p>
      </header>

      <div role="tablist" aria-label="راهنمای ساختار" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.key}
            role="tab"
            type="button"
            aria-selected={tab === item.key}
            onClick={() => selectTab(item.key)}
            className={`rounded-xl px-3 py-1.5 text-sm ${tab === item.key ? "bg-emerald-700 text-white" : "border bg-card hover:bg-secondary"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "entities" ? (
        <div className="grid gap-4 md:grid-cols-2">
          {GUIDE_ENTITIES.map((entity) => (
            <article key={entity.title} className="rounded-2xl border bg-card p-4 shadow-sm">
              <h2 className="mb-2 font-bold">{entity.title}</h2>
              <p className="text-sm text-muted-foreground">{entity.summary}</p>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {entity.relations.map((relation) => <li key={relation}>{relation}</li>)}
              </ul>
            </article>
          ))}
        </div>
      ) : null}

      {tab === "flows" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {GUIDE_FLOWS.map((flow) => (
            <article key={flow.title} className="rounded-2xl border bg-card p-4 shadow-sm">
              <h2 className="mb-2 font-bold">{flow.title}</h2>
              <ol className="list-decimal space-y-1 pr-4 text-sm text-muted-foreground">
                {flow.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              <h3 className="mt-3 text-xs font-semibold">قیدهای الزامی</h3>
              <ul className="mt-1 list-disc space-y-1 pr-4 text-xs text-amber-700 dark:text-amber-300">
                {flow.guardrails.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
          ))}
        </div>
      ) : null}

      {tab === "pages" ? (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[48rem] text-sm">
            <caption className="sr-only">راهنمای صفحه‌به‌صفحه</caption>
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th scope="col" className="p-3 text-right whitespace-nowrap">صفحه</th>
                <th scope="col" className="p-3 text-right">مالک</th>
                <th scope="col" className="p-3 text-right">جریان</th>
                <th scope="col" className="p-3 text-right">معیار پذیرش</th>
                <th scope="col" className="p-3 text-right">مسیر کد</th>
              </tr>
            </thead>
            <tbody>
              {GUIDE_PAGES.map((row) => (
                <tr key={row.page} className="border-b last:border-0">
                  {/* The cell declares its own right alignment and keeps the name on one line, so the
                      names stack in a single column instead of wrapping into centred lines. */}
                  <td className="p-3 text-right whitespace-nowrap">
                    <button type="button" onClick={() => navigate(row.page)} className="text-right font-medium text-emerald-700 hover:underline dark:text-emerald-300">{row.label}</button>
                  </td>
                  <td className="p-3 text-muted-foreground">{row.owner}</td>
                  <td className="p-3 text-muted-foreground">{row.flow}</td>
                  <td className="p-3 text-muted-foreground">{row.acceptance}</td>
                  <td className="p-3 text-xs text-muted-foreground" dir="ltr">{row.code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "rules" ? (
        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="mb-3 font-bold">قواعد مشترک</h2>
          <ul className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
            {GUIDE_RULES.map((rule) => <li key={rule}>{rule}</li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
