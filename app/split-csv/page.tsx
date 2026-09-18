import { ToolPage } from "@/components/ToolPage";
import { SplitCsvApp } from "@/components/tools/SplitCsvApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("split-csv");

export default function Page() {
  return (
    <ToolPage slug="split-csv">
      <SplitCsvApp />
    </ToolPage>
  );
}
