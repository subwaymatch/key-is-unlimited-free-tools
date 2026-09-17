import { ToolPage } from "@/components/ToolPage";
import { EditTagsApp } from "@/components/tools/EditTagsApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("edit-tags");

export default function Page() {
  return (
    <ToolPage slug="edit-tags">
      <EditTagsApp />
    </ToolPage>
  );
}
