import { ToolPage } from "@/components/ToolPage";
import { AddPdfBookmarksApp } from "@/components/tools/AddPdfBookmarksApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("add-pdf-bookmarks");

export default function Page() {
  return (
    <ToolPage slug="add-pdf-bookmarks">
      <AddPdfBookmarksApp />
    </ToolPage>
  );
}
