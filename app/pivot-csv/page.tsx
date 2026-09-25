import { ToolPage } from "@/components/ToolPage";
import { PivotCsvApp } from "@/components/tools/PivotCsvApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("pivot-csv");

export default function Page() {
  return (
    <ToolPage slug="pivot-csv">
      <PivotCsvApp />
    </ToolPage>
  );
}
