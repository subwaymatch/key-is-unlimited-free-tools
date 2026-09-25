import { ToolPage } from "@/components/ToolPage";
import { UnlockPdfApp } from "@/components/tools/UnlockPdfApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("unlock-pdf");

export default function Page() {
  return (
    <ToolPage slug="unlock-pdf">
      <UnlockPdfApp />
    </ToolPage>
  );
}
