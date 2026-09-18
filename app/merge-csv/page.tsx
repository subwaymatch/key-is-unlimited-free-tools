import { ToolPage } from "@/components/ToolPage";
import { MergeCsvApp } from "@/components/tools/MergeCsvApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("merge-csv");

export default function Page() {
  return (
    <ToolPage slug="merge-csv">
      <MergeCsvApp />
    </ToolPage>
  );
}
