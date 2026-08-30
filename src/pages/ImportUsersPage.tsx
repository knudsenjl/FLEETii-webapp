// Bulk user-import page ("/import-users" — reached via DepartmentPage.tsx's
// "Opret brugere fra fil" button). Thin wrapper around BulkImportPage (see
// its own doc comment for the shared mechanics) — POSTs to
// netlify/functions/bulk-import-users.mts.
import { BulkImportPage } from "../components/BulkImportPage";

export function ImportUsersPage() {
  return (
    <BulkImportPage
      pageTitle="Opret brugere fra fil"
      endpoint="bulk-import-users"
      templateBaseName="brugere"
      nounPlural="Brugere"
      formatResultNoun={(count) => `${count} bruger${count === 1 ? "" : "e"}`}
    />
  );
}
