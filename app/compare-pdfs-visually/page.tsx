import { ToolPage } from "@/components/ToolPage";
import { ComparePdfsVisuallyApp } from "@/components/tools/ComparePdfsVisuallyApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("compare-pdfs-visually");

export default function Page() {
  return (
    <ToolPage slug="compare-pdfs-visually">
      <ComparePdfsVisuallyApp />
    </ToolPage>
  );
}
