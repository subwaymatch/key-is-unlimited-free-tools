import { ToolPage } from "@/components/ToolPage";
import { ProtectPdfApp } from "@/components/tools/ProtectPdfApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("protect-pdf");

export default function Page() {
  return (
    <ToolPage slug="protect-pdf">
      <ProtectPdfApp />
    </ToolPage>
  );
}
