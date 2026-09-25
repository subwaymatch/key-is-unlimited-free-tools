import { ToolPage } from "@/components/ToolPage";
import { SanitizeHarApp } from "@/components/tools/SanitizeHarApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("sanitize-har");

export default function Page() {
  return (
    <ToolPage slug="sanitize-har">
      <SanitizeHarApp />
    </ToolPage>
  );
}
