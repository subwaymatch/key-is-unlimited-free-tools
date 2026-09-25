import { ToolPage } from "@/components/ToolPage";
import { CheckPdfRedactionApp } from "@/components/tools/CheckPdfRedactionApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("check-pdf-redaction");

export default function Page() {
  return (
    <ToolPage slug="check-pdf-redaction">
      <CheckPdfRedactionApp />
    </ToolPage>
  );
}
