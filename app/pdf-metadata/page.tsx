import { ToolPage } from "@/components/ToolPage";
import { PdfMetadataApp } from "@/components/tools/PdfMetadataApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("pdf-metadata");

export default function Page() {
  return (
    <ToolPage slug="pdf-metadata">
      <PdfMetadataApp />
    </ToolPage>
  );
}
