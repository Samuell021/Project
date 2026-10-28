import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getTaskStatusPresentation, TaskStatusIcon } from "./StatusBadge";

const renderIcon = (status: string) =>
  renderToStaticMarkup(createElement(TaskStatusIcon, { status }));

describe("task status presentation", () => {
  it("uses a hollow-circle marker for pending tasks", () => {
    expect(getTaskStatusPresentation("PENDING")).toMatchObject({
      status: "PENDING",
      variant: "muted",
      icon: "pending",
    });
    const icon = renderIcon("PENDING");
    expect(icon).toContain("text-muted-foreground");
    expect(icon).toContain("lucide-circle");
    expect(icon).toContain('stroke-width="2.2"');
  });

  it("uses a yellow icon for in-progress tasks", () => {
    expect(getTaskStatusPresentation("In Progress")).toMatchObject({
      status: "IN_PROGRESS",
      variant: "warning",
      icon: "inProgress",
    });
    const icon = renderIcon("IN_PROGRESS");
    expect(icon).toContain("text-amber-500 dark:text-amber-300");
    expect(icon).toContain("lucide-clock-3");
    expect(icon).toContain('stroke-width="2.6"');
  });

  it("uses a green tick inside the circle for completed tasks", () => {
    expect(getTaskStatusPresentation("completed")).toMatchObject({
      status: "COMPLETED",
      variant: "success",
      icon: "completed",
    });
    const icon = renderIcon("COMPLETED");
    expect(icon).toContain("text-emerald-600 dark:text-emerald-300");
    expect(icon).toContain("lucide-circle-check");
    expect(icon).toContain("<path");
  });

  it("uses a red circle crossed out for cancelled tasks", () => {
    expect(getTaskStatusPresentation("cancelled")).toMatchObject({
      status: "CANCELLED",
      variant: "danger",
      icon: "cancelled",
    });
    const icon = renderIcon("CANCELLED");
    expect(icon).toContain("text-red-600 dark:text-red-300");
    expect(icon).toContain("lucide-circle-x");
    expect(icon).toContain('stroke-width="2.6"');
    expect(icon).toContain("<path");
  });

  it("renders every marker at a legible size and weight", () => {
    for (const status of ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]) {
      const icon = renderIcon(status);
      expect(icon).toContain('width="14"');
      expect(icon).toContain("stroke-width=");
    }
    expect(renderIcon("PENDING")).not.toContain("<path");
  });
});
