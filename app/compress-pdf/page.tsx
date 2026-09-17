import { ToolPage } from "@/components/ToolPage";
import { CompressPdfApp } from "@/components/tools/CompressPdfApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("compress-pdf");

export default function Page() {
  return (
    <ToolPage slug="compress-pdf">
      <CompressPdfApp />
    </ToolPage>
  );
}
