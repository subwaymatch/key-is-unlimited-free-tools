import { ToolPage } from "@/components/ToolPage";
import { FormatJsonApp } from "@/components/tools/FormatJsonApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("format-json");

export default function Page() {
  return (
    <ToolPage slug="format-json">
      <FormatJsonApp />
    </ToolPage>
  );
}
