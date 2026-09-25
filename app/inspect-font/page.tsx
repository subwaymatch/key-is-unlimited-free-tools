import { ToolPage } from "@/components/ToolPage";
import { InspectFontApp } from "@/components/tools/InspectFontApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("inspect-font");

export default function Page() {
  return (
    <ToolPage slug="inspect-font">
      <InspectFontApp />
    </ToolPage>
  );
}
