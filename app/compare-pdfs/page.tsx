import { ToolPage } from "@/components/ToolPage";
import { ComparePdfsApp } from "@/components/tools/ComparePdfsApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("compare-pdfs");

export default function Page() {
  return (
    <ToolPage slug="compare-pdfs">
      <ComparePdfsApp />
    </ToolPage>
  );
}
