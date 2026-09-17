import { ToolPage } from "@/components/ToolPage";
import { SplitPdfApp } from "@/components/tools/SplitPdfApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("split-pdf");

export default function Page() {
  return (
    <ToolPage slug="split-pdf">
      <SplitPdfApp />
    </ToolPage>
  );
}
