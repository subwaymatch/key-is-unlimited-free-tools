import { ToolPage } from "@/components/ToolPage";
import { PdfToTextApp } from "@/components/tools/PdfToTextApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("pdf-to-text");

export default function Page() {
  return (
    <ToolPage slug="pdf-to-text">
      <PdfToTextApp />
    </ToolPage>
  );
}
