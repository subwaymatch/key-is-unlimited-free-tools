import { ToolPage } from "@/components/ToolPage";
import { PdfToImagesApp } from "@/components/tools/PdfToImagesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("pdf-to-images");

export default function Page() {
  return (
    <ToolPage slug="pdf-to-images">
      <PdfToImagesApp />
    </ToolPage>
  );
}
