import { ToolPage } from "@/components/ToolPage";
import { JoinFilesApp } from "@/components/tools/JoinFilesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("join-files");

export default function Page() {
  return (
    <ToolPage slug="join-files">
      <JoinFilesApp />
    </ToolPage>
  );
}
