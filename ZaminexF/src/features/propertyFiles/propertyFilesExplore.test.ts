import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertyFilesPage } from "./pages/PropertyFilesPage";
import { getRoleNavPages } from "../../shared/lib/navPages";
import { buildAppPath, parseAppLocation } from "../../shared/lib/appRouting";

const read = (relativePath: string): string =>
  readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

const propertyFilesPage = read("src/features/propertyFiles/pages/PropertyFilesPage.tsx");
const propertyFileDetailPage = read("src/features/propertyFiles/pages/PropertyFileDetailPage.tsx");
const propertyFileExplorer = read("src/features/propertyFiles/components/PropertyFileExplorer.tsx");
const propertyFileDetailModal = read("src/features/propertyFiles/components/PropertyFileDetailModal.tsx");
const matchAssistantDrawer = read("src/features/propertyFiles/components/MatchAssistantDrawer.tsx");
const sidebar = read("src/features/auth/Sidebar.tsx");
const app = read("src/app/App.tsx");
const routing = read("src/shared/lib/appRouting.ts");

describe("staff propertyFile explorer routes", () => {
  it("defaults to mine and derives the visible section from the current route prop", () => {
    expect(propertyFilesPage).toContain('initialTab = "mine"');
    expect(propertyFilesPage).toContain('initialTab?: "mine" | "explore"');
    expect(propertyFilesPage).toContain("const activeTab = initialTab");
    expect(propertyFilesPage).toContain("فایل‌های من");
    expect(propertyFilesPage).toContain("اکسپلور فایل‌های عرضه");
    expect(propertyFilesPage).toContain("<PropertyFileExplorer navigate={navigate} />");
    expect(propertyFilesPage).not.toContain('role="tablist"');
    expect(propertyFilesPage).not.toContain('role="tab"');
    expect(propertyFilesPage).not.toContain('role="tabpanel"');
    expect(propertyFileExplorer).toContain('role="region" aria-label="اکسپلور فایل‌ها"');
  });

  it("keeps the explorer independent from private propertyFile data", () => {
    expect(propertyFilesPage).toContain('{activeTab === "mine" && (');
    expect(propertyFilesPage).toContain('{activeTab === "explore" ? (');
    expect(propertyFilesPage).toContain('if (activeTab !== "mine") return;');
    expect(propertyFilesPage).toContain("[activeTab, fetchServerPropertyFiles]");
  });

  it("wires sidebar navigation and browser history to an independent explore route", () => {
    expect(app).toContain('pageRegistry["my-property-files"] = pageRegistry["property-files"]');
    expect(app).toContain('pageRegistry["property-files-explore"] = pageRegistry["property-files"]');
    expect(app).toContain('initialTab={page === "property-files-explore" || page === "crm-explore" ? "explore" : "mine"}');
    expect(app).toContain("navigate={navigate}");
    for (const role of ["admin", "range_manager", "consultant"] as const) {
      expect(getRoleNavPages(role).some((item) => item.page === "property-files-explore")).toBe(true);
    }
    expect(sidebar).toContain("navigate(item.page)");
    expect(routing).toContain('return "/app/property-files/explore/"');
    expect(app).toContain('window.history.pushState({ page: nextPage }, "", destination)');
    expect(app).toContain('window.addEventListener("popstate", handlePopState)');
    expect(app).toContain("setPage(nextRoute.page)");
  });

  it("removes the old website propertyFiles shortcut from the sidebar", () => {
    expect(sidebar).not.toContain("/property-files/explore/");
    expect(sidebar).not.toContain("فایل‌های وب‌سایت");
  });

  it("wires the matching assistant drawer cleanly in explore without stale snake_case references", () => {
    expect(propertyFilesPage).toContain("<MatchAssistantDrawer");
    expect(propertyFilesPage).toContain("دستیار تطبیقی");
    expect(propertyFilesPage).toContain("open={assistantOpen && activeTab === \"explore\"}");
    expect(propertyFilesPage).toContain("onOpenPropertyFile={openMatchPropertyFile}");
    expect(matchAssistantDrawer).toContain("/property-files/api/property-files/recommendations/");
    expect(matchAssistantDrawer).toContain("rankPropertyFileMatches(rows, criteria)");
    expect(matchAssistantDrawer).toContain("propertyFile.consultantName");
    expect(matchAssistantDrawer).toContain("propertyFile.consultantAvatar");
    expect(matchAssistantDrawer).toContain('propertyFile.isMine ? "فایل من" : "فقط‌خواندنی"');
    expect(matchAssistantDrawer).not.toContain("property_file");
  });
});

describe("explore tab wiring", () => {
  it("reads the active propertyFiles of every consultant", () => {
    expect(propertyFileExplorer).toContain("/property-files/api/property-files/explore/");
    expect(propertyFileDetailModal).toContain("/property-files/api/property-files/explore/${propertyFileId}/");
    expect(propertyFileExplorer).toContain("<PropertyFileDetailModal");
    expect(propertyFileExplorer).toContain("buildPropertyFileExploreParams(");
    expect(propertyFileExplorer).toContain("PROPERTY_FILE_CHANNEL_CODES");
  });

  it("shows the responsible consultant of every propertyFile", () => {
    expect(propertyFileExplorer).toContain("propertyFile.consultantName");
    expect(propertyFileExplorer).toContain("propertyFile.consultantAvatar");
    expect(propertyFileExplorer).toContain("consultantInitials(");
    expect(propertyFileExplorer).toContain("فایل من");
  });

  it("introduces a customer through the ticket inquiry endpoint", () => {
    expect(propertyFileDetailModal).toContain("/tickets/api/property-file-inquiries/");
    expect(propertyFileDetailModal).toContain("buildPropertyFileInquiryPayload(");
    expect(propertyFileDetailModal).toContain("propertyFileInquiryValidationError(");
    expect(propertyFileExplorer).toContain("معرفی به مشتری");
    expect(propertyFileDetailModal).toContain("ticketNumber");
    expect(propertyFileDetailModal).toContain("نام مشتری");
    expect(propertyFileDetailModal).toContain("شماره تماس مشتری");
  });
});

describe("customer recommendation card targets", () => {
  it("shares the read-only modal and refreshes customer results on request", () => {
    expect(propertyFilesPage).toContain("<PropertyFileDetailModal");
    expect(propertyFilesPage).toContain("propertyFileId={matchPropertyFileId}");
    expect(propertyFilesPage).toContain("onClose={() => setMatchPropertyFileId(null)}");
    expect(propertyFilesPage).toContain("setMatchSearchRevision((revision) => revision + 1)");
    expect(propertyFileExplorer).toContain("propertyFileId={detailId}");
    expect(propertyFileExplorer).toContain("setRevision((value) => value + 1)");
    expect(propertyFileExplorer).not.toContain('role="dialog"');
  });

  it("uses the same ownership rule for explorer and match assistant detail buttons", () => {
    expect(propertyFileExplorer).toContain("onClick={() => openPropertyFile(propertyFile)}");
    expect(propertyFileExplorer).toContain("const target = propertyFileCardTarget(propertyFile)");
    expect(propertyFileExplorer).toContain("else setDetailId(target.id)");
    expect(propertyFileExplorer).toContain('propertyFile.isMine ? "فایل من" : "فقط‌خواندنی"');
    expect(propertyFilesPage).toContain("const target = propertyFileCardTarget(propertyFile)");
    expect(propertyFilesPage).toContain('if (target.kind === "property-file-detail")');
    expect(propertyFileDetailPage).toContain('can("property_file.edit")');
    expect(propertyFileDetailPage).toContain('can("property_file.review")');
    expect(propertyFileDetailPage).toContain('can("property_file.status")');
  });
});

describe("propertyFile route rendering", () => {
  const props = {
    navigate: () => {},
    role: "consultant" as const,
    consultants: [],
    properties: [],
    propertyFiles: [],
    onAction: () => {},
    loading: false,
  };

  it("renders the own propertyFiles section by default without in-page tabs or match assistant button", () => {
    const html = renderToStaticMarkup(createElement(PropertyFilesPage, props));
    expect(html).toContain('role="region" aria-label="فایل‌های من"');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('aria-label="اکسپلور فایل‌ها"');
    expect(html).not.toContain("دستیار تطبیقی");
  });

  it("renders explore independently with the match assistant trigger when its shareable route is selected", () => {
    const route = parseAppLocation(buildAppPath("property-files-explore"), "", "consultant-dashboard");
    const html = renderToStaticMarkup(createElement(PropertyFilesPage, {
      ...props,
      initialTab: route.page === "property-files-explore" ? "explore" : "mine",
    }));
    expect(html).toContain('role="region" aria-label="اکسپلور فایل‌ها"');
    expect(html).toContain("دستیار تطبیقی");
    expect(html).not.toContain('role="region" aria-label="فایل‌های من"');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("نمایش فایل‌های فروخته‌شده");
  });
});
