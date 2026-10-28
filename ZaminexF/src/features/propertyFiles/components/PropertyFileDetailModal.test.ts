import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PropertyFileDetailModal } from "./PropertyFileDetailModal";

const source = readFileSync(path.resolve(process.cwd(), "src/features/propertyFiles/components/PropertyFileDetailModal.tsx"), "utf8");

describe("shared propertyFile detail modal", () => {
  it("starts as a labelled read-only dialog with a loading indicator", () => {
    const html = renderToStaticMarkup(createElement(PropertyFileDetailModal, {
      propertyFileId: 12,
      onClose: () => {},
      navigate: () => {},
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="جزئیات فایل و معرفی به مشتری"');
    expect(html).toContain('aria-label="بستن جزئیات فایل"');
    expect(html).toContain("فقط‌خواندنی");
    expect(html).toContain("در حال دریافت جزئیات");
  });

  it("loads details through the read-only explore endpoint", () => {
    expect(source).toContain("/property-files/api/property-files/explore/${propertyFileId}/");
    expect(source).not.toContain("/property-files/api/property-files/${propertyFileId}/");
    expect(source).toContain("[propertyFileId, detailRevision]");
    expect(source).toContain("signal: controller.signal");
    expect(source).toContain("return () => controller.abort()");
  });

  it("softens stale propertyFile errors and offers retry and result refresh", () => {
    expect(source).toContain("این فایل در دسترس نیست؛ ممکن است وضعیت آن تغییر کرده باشد");
    expect(source).toContain("تلاش دوباره");
    expect(source).toContain("setDetailRevision((value) => value + 1)");
    expect(source).toContain("به‌روزرسانی نتایج");
    expect(source).toContain("onClick={refreshResults}");
    expect(source).toContain("response.status === 404 || response.status === 410");
    expect(source).toContain("if (onRefresh) onRefresh()");
  });

  it("keeps the inquiry workflow while guarding the private detail shortcut", () => {
    expect(source).toContain("/tickets/api/property-file-inquiries/");
    expect(source).toContain("buildPropertyFileInquiryPayload(detail.id, inquiry)");
    expect(source).toContain("onIntroduced?.(detail.id)");
    expect(source).toMatch(/\{detail\.isMine && \([\s\S]*?navigate\("property-file-detail", detail\.id\)/);
    expect(source).not.toContain('navigate("edit-property-file"');
    expect(source).not.toContain('method: "PATCH"');
    expect(source).not.toContain('method: "DELETE"');
  });

  it("supports Escape, focus containment and restoring focus on close", () => {
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain('event.key !== "Tab"');
    expect(source).toContain("first.focus()");
    expect(source).toContain("last.focus()");
    expect(source).toContain("previousFocus.focus()");
    expect(source).toContain('window.removeEventListener("keydown", onKeyDown)');
  });
});
