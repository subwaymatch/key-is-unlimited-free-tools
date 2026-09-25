import { ToolPage } from "@/components/ToolPage";
import { CompareCsvApp } from "@/components/tools/CompareCsvApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("compare-csv");

export default function Page() {
  return (
    <ToolPage slug="compare-csv">
      <CompareCsvApp />
    </ToolPage>
  );
}
