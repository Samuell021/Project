import React from "react";
import { createRoot } from "react-dom/client";
import "../styles/index.css";
import { AppThemeProvider } from "../shared/components/AppThemeProvider";
import { applySavedThemePreference } from "../shared/lib/appTheme";
import { PropertyFilesPage } from "../features/propertyFiles/pages/PropertyFilesPage";

type PropertyFileItem = {
  id: string;
  propertyId?: string | null;
  property: string;
  channels: string[];
  status: string;
  publishedAt?: string | null;
  expires?: string | null;
  views: number;
  score?: number | null;
  consultant?: string | null;
  consultantId?: string | null;
  title?: string | null;
  priority?: string | number | null;
  featured?: boolean;
  createdBy?: string | null;
  assignedTo?: string | null;
};

type BackendPropertyFile = {
  id?: number | string;
  title?: string | null;
  status?: string | null;
  priority?: number | string | null;
  property_title?: string | null;
  propertyId?: string | null;
  channels?: unknown;
  created_by?: string | null;
  assigned_to?: string | null;
  views?: number | null;
  consultant?: string | null;
  consultantId?: string | null;
  score?: number | null;
  publishedAt?: string | null;
  expires?: string | null;
  featured?: boolean | null;
};

function safeParseJson(id: string): unknown | null {
  const el = document.getElementById(id);
  if (!el) return null;
  try {
    return JSON.parse(el.textContent ?? "null");
  } catch {
    return null;
  }
}

function normalizeBackendPropertyFile(b: BackendPropertyFile): PropertyFileItem {
  const id = b.id !== undefined && b.id !== null ? String(b.id) : "";
  const property = b.property_title ?? b.title ?? `PropertyFile ${id}`;
  const channels = Array.isArray(b.channels) ? b.channels.filter((c): c is string => typeof c === "string") : [];
  const status = b.status ?? "Draft";
  const views = typeof b.views === "number" ? b.views : 0;
  const item: PropertyFileItem = {
    id,
    propertyId: b.propertyId ?? undefined,
    property,
    channels,
    status,
    publishedAt: b.publishedAt ?? null,
    expires: b.expires ?? null,
    views,
    score: b.score ?? null,
    consultant: b.consultant ?? null,
    consultantId: b.consultantId ?? null,
    title: b.title ?? null,
    priority: b.priority ?? null,
    featured: b.featured ?? false,
    createdBy: b.created_by ?? null,
    assignedTo: b.assigned_to ?? null,
  };
  return item;
}

applySavedThemePreference();

document.addEventListener("DOMContentLoaded", () => {
  const mount = document.getElementById("propertyFile-list-root");
  if (!mount) return;

  const raw = safeParseJson("propertyFile-props") as { current_user?: { id?: number | string; username?: string; role?: string } | undefined; initial_propertyFiles?: BackendPropertyFile[] } | null;
  const backendPropertyFiles = Array.isArray(raw?.initial_propertyFiles) ? raw!.initial_propertyFiles : [];
  const initialPropertyFiles: PropertyFileItem[] = backendPropertyFiles.map(normalizeBackendPropertyFile);

  const role = raw?.current_user && raw.current_user.role ? (String(raw.current_user.role).toUpperCase() === "ADMIN" ? "admin" : "consultant") : undefined;

  const navigate = (target: string) => {
    if (!target) return;
    const detailMatch = target.match(/[?&]id=([^&]+)/);
    if (target.startsWith("property-file-detail") && detailMatch && detailMatch[1]) {
      window.location.href = `/property-files/${encodeURIComponent(detailMatch[1])}/`;
      return;
    }
    if (target.startsWith("edit-property-file") && detailMatch && detailMatch[1]) {
      window.location.href = `/property-files/${encodeURIComponent(detailMatch[1])}/edit/`;
      return;
    }
    if (target === "create-property-file") {
      window.location.href = `/property-files/create/`;
      return;
    }
    window.location.href = `/property-files/`;
  };

  createRoot(mount).render(
    <AppThemeProvider>
      <PropertyFilesPage
        navigate={navigate as any}
        role={role as any}
        currentConsultantId={undefined}
        consultants={[]}
        properties={[]}
        propertyFiles={initialPropertyFiles as any}
        onAction={() => {}}
        loading={false}
      />
    </AppThemeProvider>
  );
});
