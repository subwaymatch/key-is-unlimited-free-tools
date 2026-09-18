import { ToolPage } from "@/components/ToolPage";
import { ExtractPdfPagesApp } from "@/components/tools/ExtractPdfPagesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("extract-pdf-pages");

export default function Page() {
  return (
    <ToolPage slug="extract-pdf-pages">
      <ExtractPdfPagesApp />
    </ToolPage>
  );
}
