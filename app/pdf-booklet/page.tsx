import { ToolPage } from "@/components/ToolPage";
import { PdfBookletApp } from "@/components/tools/PdfBookletApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("pdf-booklet");

export default function Page() {
  return (
    <ToolPage slug="pdf-booklet">
      <PdfBookletApp />
    </ToolPage>
  );
}
