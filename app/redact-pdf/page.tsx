import { ToolPage } from "@/components/ToolPage";
import { RedactPdfApp } from "@/components/tools/RedactPdfApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("redact-pdf");

export default function Page() {
  return (
    <ToolPage slug="redact-pdf">
      <RedactPdfApp />
    </ToolPage>
  );
}
