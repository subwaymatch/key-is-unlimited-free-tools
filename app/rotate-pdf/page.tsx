import { ToolPage } from "@/components/ToolPage";
import { RotatePdfApp } from "@/components/tools/RotatePdfApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("rotate-pdf");

export default function Page() {
  return (
    <ToolPage slug="rotate-pdf">
      <RotatePdfApp />
    </ToolPage>
  );
}
