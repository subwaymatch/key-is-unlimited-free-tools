import { ToolPage } from "@/components/ToolPage";
import { RemoveImageMetadataApp } from "@/components/tools/RemoveImageMetadataApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("remove-image-metadata");

export default function Page() {
  return (
    <ToolPage slug="remove-image-metadata">
      <RemoveImageMetadataApp />
    </ToolPage>
  );
}
