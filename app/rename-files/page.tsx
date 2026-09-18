import { ToolPage } from "@/components/ToolPage";
import { RenameFilesApp } from "@/components/tools/RenameFilesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("rename-files");

export default function Page() {
  return (
    <ToolPage slug="rename-files">
      <RenameFilesApp />
    </ToolPage>
  );
}
