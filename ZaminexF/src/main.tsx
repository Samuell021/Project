import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";

const App = lazy(() => import("./app/App.tsx"));
const PublicPropertyFilesPage = lazy(() =>
  import("./features/propertyFiles/pages/PublicPropertyFilesPage.tsx").then((module) => ({ default: module.PublicPropertyFilesPage })),
);
const PublicPropertyFileDetailPage = lazy(() =>
  import("./features/propertyFiles/pages/PublicPropertyFileDetailPage.tsx").then((module) => ({ default: module.PublicPropertyFileDetailPage })),
);
import { setSessionAuthenticated } from "./shared/lib/apiClient";
import "./styles/index.css";
import { AppThemeProvider } from "./shared/components/AppThemeProvider";
import { applySavedThemePreference } from "./shared/lib/appTheme";

const initialDataElement = document.getElementById("initial-data");
const initialData = initialDataElement
  ? JSON.parse(initialDataElement.textContent || "{}")
  : { isAuthenticated: false, role: null, userName: "", currentConsultantId: null, initialPage: "login" };

setSessionAuthenticated(Boolean(initialData.isAuthenticated));

const publicPropertyFilesRoot = document.getElementById("public-property-files-root");
const publicPropertyFileDetailRoot = document.getElementById("public-property-file-detail-root");
applySavedThemePreference(initialData.brandTheme);

if (publicPropertyFilesRoot) {
  createRoot(publicPropertyFilesRoot).render(
    <AppThemeProvider>
      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">در حال بارگذاری…</div>}>
        <PublicPropertyFilesPage />
      </Suspense>
    </AppThemeProvider>
  );
} else if (publicPropertyFileDetailRoot) {
  createRoot(publicPropertyFileDetailRoot).render(
    <AppThemeProvider>
      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">در حال بارگذاری…</div>}>
        <PublicPropertyFileDetailPage isAuthenticated={Boolean(initialData.isAuthenticated)} />
      </Suspense>
    </AppThemeProvider>
  );
} else {
  const appRoot = document.getElementById("root");
  if (appRoot) {
    createRoot(appRoot).render(
      <AppThemeProvider>
        <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">در حال بارگذاری برنامه…</div>}>
          <App initialData={initialData} />
        </Suspense>
      </AppThemeProvider>
    );
  }
}
