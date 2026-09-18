import { ToolPage } from "@/components/ToolPage";
import { ExtractPdfImagesApp } from "@/components/tools/ExtractPdfImagesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("extract-pdf-images");

export default function Page() {
  return (
    <ToolPage slug="extract-pdf-images">
      <ExtractPdfImagesApp />
    </ToolPage>
  );
}
