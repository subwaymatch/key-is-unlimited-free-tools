import { ToolPage } from "@/components/ToolPage";
import { RemoveMetadataApp } from "@/components/tools/RemoveMetadataApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("remove-metadata");

export default function Page() {
  return (
    <ToolPage slug="remove-metadata">
      <RemoveMetadataApp />
    </ToolPage>
  );
}
