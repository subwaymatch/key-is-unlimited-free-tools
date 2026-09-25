import { ToolPage } from "@/components/ToolPage";
import { EditEpubMetadataApp } from "@/components/tools/EditEpubMetadataApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("edit-epub-metadata");

export default function Page() {
  return (
    <ToolPage slug="edit-epub-metadata">
      <EditEpubMetadataApp />
    </ToolPage>
  );
}
