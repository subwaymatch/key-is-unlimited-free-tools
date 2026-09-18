import { ToolPage } from "@/components/ToolPage";
import { ExtractColoursApp } from "@/components/tools/ExtractColoursApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("extract-colours");

export default function Page() {
  return (
    <ToolPage slug="extract-colours">
      <ExtractColoursApp />
    </ToolPage>
  );
}
