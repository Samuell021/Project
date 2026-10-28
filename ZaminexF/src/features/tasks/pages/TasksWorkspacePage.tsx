import type { ComponentProps } from "react";
import { usePageQuery } from "../../../shared/lib/pageQuery";
import type { Page } from "../../../shared/lib/types";
import { MyTasksPage } from "./MyTasksPage";
import { TasksKanban } from "./TasksKanban";
import { TasksCalendar } from "./TasksCalendar";

type ListProps = ComponentProps<typeof MyTasksPage>;
type KanbanProps = ComponentProps<typeof TasksKanban>;
type CalendarProps = ComponentProps<typeof TasksCalendar>;

const VIEWS = [
  { key: "list", label: "فهرست" },
  { key: "board", label: "تخته" },
  { key: "calendar", label: "تقویم" },
] as const;

type TaskView = (typeof VIEWS)[number]["key"];

const DEFAULT_VIEW: Partial<Record<Page, TaskView>> = {
  "tasks-kanban": "board",
  "create-task": "board",
  "tasks-calendar": "calendar",
};

function isTaskView(value: string | null): value is TaskView {
  return value === "list" || value === "board" || value === "calendar";
}

export default function TasksWorkspacePage({
  page,
  list,
  board,
  calendar,
}: {
  page: Page;
  list: ListProps;
  board: KanbanProps;
  calendar: CalendarProps;
}) {
  const { query, update } = usePageQuery();
  const requested = query.get("view");
  const active: TaskView = isTaskView(requested) ? requested : (DEFAULT_VIEW[page] ?? "list");

  function selectView(view: TaskView) {
    update({ view: view === "list" ? null : view });
  }

  return (
    <div dir="rtl">
      <div className="px-6 pt-6 max-w-7xl mx-auto">
        <div role="tablist" aria-label="نمای وظایف" className="flex flex-wrap gap-1.5 border-b border-border">
          {VIEWS.map((view) => (
            <button
              key={view.key}
              role="tab"
              type="button"
              aria-selected={active === view.key}
              onClick={() => selectView(view.key)}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors ${active === view.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {view.label}
            </button>
          ))}
        </div>
      </div>
      {active === "list" ? <MyTasksPage {...list} /> : null}
      {active === "board" ? <TasksKanban {...board} /> : null}
      {active === "calendar" ? <TasksCalendar {...calendar} /> : null}
    </div>
  );
}
