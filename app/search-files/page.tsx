import { ToolPage } from "@/components/ToolPage";
import { SearchFilesApp } from "@/components/tools/SearchFilesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("search-files");

export default function Page() {
  return (
    <ToolPage slug="search-files">
      <SearchFilesApp />
    </ToolPage>
  );
}
