import type { CrmPageProps } from "./types";
import type { Role } from "../../shared/lib/types";
import { pageIsAllowed } from "../../shared/lib/permissions";
import { Contacts } from "./pages/ContactsPage";
import { Inbox } from "./pages/InboxPage";
import { PropertyRegisterPage } from "./pages/PropertyRegisterPage";
import { PropertyCasesPage } from "./pages/PropertyCasesPage";
import { ReviewsQueuePage } from "./pages/ReviewsQueuePage";
import { Inquiries } from "./pages/InquiriesPage";
import { InquiryRegisterPage } from "./pages/InquiryRegisterPage";
import { Introductions } from "./pages/IntroductionsPage";
import { Viewings } from "./pages/ViewingsPage";
import { Pipelines } from "./pages/PipelinesPage";
import { Deals } from "./pages/DealsPage";
import { Contracts } from "./pages/ContractsPage";
import { Finance } from "./pages/FinancePage";
import { DealTypes } from "./pages/DealTypesPage";
import { Reports } from "./pages/ReportsPage";
import { CrmSettings } from "./pages/CrmSettingsPage";

export default function CrmPages({ csrfToken, page, role, currentUserId, navigate, recordId, embedded = false }: CrmPageProps) {
  if (page === "crm-contacts") return <Contacts csrfToken={csrfToken} navigate={navigate} initialRecordId={recordId} />;
  if (page === "crm-inbox") return <Inbox csrfToken={csrfToken} navigate={navigate} />;
  if (page === "crm-property-register") {
    return (
      <PropertyRegisterPage
        csrfToken={csrfToken}
        page={page}
        role={role}
        currentUserId={currentUserId}
        recordId={recordId}
        embedded={embedded}
        navigate={navigate}
      />
    );
  }
  if (page === "crm-property-cases") {
    return (
      <PropertyCasesPage
        csrfToken={csrfToken}
        page={page}
        role={role}
        currentUserId={currentUserId}
        recordId={recordId}
        embedded={embedded}
        navigate={navigate}
      />
    );
  }
  if (page === "crm-reviews") {
    return (
      <ReviewsQueuePage
        csrfToken={csrfToken}
        page={page}
        role={role}
        currentUserId={currentUserId}
        recordId={recordId}
        embedded={embedded}
        navigate={navigate}
      />
    );
  }
  if (page === "crm-inquiries") return <Inquiries csrfToken={csrfToken} navigate={navigate} initialRecordId={recordId} role={role} currentUserId={currentUserId} />;
  if (page === "crm-inquiry-register") return <InquiryRegisterPage csrfToken={csrfToken} navigate={navigate} role={role} currentUserId={currentUserId} recordId={recordId} />;
  if (page === "crm-introductions") return <Introductions csrfToken={csrfToken} navigate={navigate} initialRecordId={recordId} role={role} currentUserId={currentUserId} />;
  if (page === "crm-viewings") return <Viewings csrfToken={csrfToken} />;
  // The board is mounted for the admin and for a consultant, whose data the server already
  // narrows to their own records. Any other role is refused here as well, even when the
  // address is typed by hand (the shell guard then sends the visitor to their own page).
  if (page === "crm-pipelines") {
    // `CrmPageProps` carries the role as a string, so it is narrowed here for the board.
    return pageIsAllowed("crm-pipelines", (role || "consultant") as Role)
      ? <Pipelines csrfToken={csrfToken} navigate={navigate} role={role as Role} />
      : null;
  }
  if (page === "crm-deals") return <Deals csrfToken={csrfToken} navigate={navigate} recordId={recordId} currentUserId={currentUserId} />;
  if (page === "crm-contracts") return <Contracts csrfToken={csrfToken} role={role} navigate={navigate} recordId={recordId} />;
  if (page === "crm-finance") return <Finance csrfToken={csrfToken} />;
  if (page === "crm-deal-types") return <DealTypes csrfToken={csrfToken} embedded={embedded} />;
  if (page === "crm-reports") return <Reports csrfToken={csrfToken} navigate={navigate} />;
  if (page === "crm-settings") return <CrmSettings csrfToken={csrfToken} navigate={navigate} embedded={embedded} />;
  return null;
}
