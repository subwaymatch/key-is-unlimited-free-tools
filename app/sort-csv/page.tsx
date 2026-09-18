import { ToolPage } from "@/components/ToolPage";
import { SortCsvApp } from "@/components/tools/SortCsvApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("sort-csv");

export default function Page() {
  return (
    <ToolPage slug="sort-csv">
      <SortCsvApp />
    </ToolPage>
  );
}
