import { ToolPage } from "@/components/ToolPage";
import { SplitPdfBySizeApp } from "@/components/tools/SplitPdfBySizeApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("split-pdf-by-size");

export default function Page() {
  return (
    <ToolPage slug="split-pdf-by-size">
      <SplitPdfBySizeApp />
    </ToolPage>
  );
}
