import { ToolPage } from "@/components/ToolPage";
import { CollateScansApp } from "@/components/tools/CollateScansApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("collate-scans");

export default function Page() {
  return (
    <ToolPage slug="collate-scans">
      <CollateScansApp />
    </ToolPage>
  );
}
