import { ToolPage } from "@/components/ToolPage";
import { PdfFormDataApp } from "@/components/tools/PdfFormDataApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("pdf-form-data");

export default function Page() {
  return (
    <ToolPage slug="pdf-form-data">
      <PdfFormDataApp />
    </ToolPage>
  );
}
