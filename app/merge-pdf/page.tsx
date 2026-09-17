import { ToolPage } from "@/components/ToolPage";
import { MergePdfApp } from "@/components/tools/MergePdfApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("merge-pdf");

export default function Page() {
  return (
    <ToolPage slug="merge-pdf">
      <MergePdfApp />
    </ToolPage>
  );
}
