import type { Page } from "../../shared/lib/types";

export type Row = Record<string, any>;
export type CrmNavigate = (page: Page, id?: string | number) => void;
export type CrmPageProps = {
  csrfToken: string;
  page: Page;
  role: string;
  currentUserId?: string | null;
  recordId?: string | null;
  embedded?: boolean;
  navigate: CrmNavigate;
};
