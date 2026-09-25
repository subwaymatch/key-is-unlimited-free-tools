import { ToolPage } from "@/components/ToolPage";
import { ExtractEmailApp } from "@/components/tools/ExtractEmailApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("extract-email");

export default function Page() {
  return (
    <ToolPage slug="extract-email">
      <ExtractEmailApp />
    </ToolPage>
  );
}
