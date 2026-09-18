import { ToolPage } from "@/components/ToolPage";
import { SortLinesApp } from "@/components/tools/SortLinesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("sort-lines");

export default function Page() {
  return (
    <ToolPage slug="sort-lines">
      <SortLinesApp />
    </ToolPage>
  );
}
