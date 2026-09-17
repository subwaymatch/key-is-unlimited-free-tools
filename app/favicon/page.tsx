import { ToolPage } from "@/components/ToolPage";
import { FaviconApp } from "@/components/tools/FaviconApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("favicon");

export default function Page() {
  return (
    <ToolPage slug="favicon">
      <FaviconApp />
    </ToolPage>
  );
}
