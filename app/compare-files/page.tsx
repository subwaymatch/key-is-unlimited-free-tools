import { ToolPage } from "@/components/ToolPage";
import { CompareFilesApp } from "@/components/tools/CompareFilesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("compare-files");

export default function Page() {
  return (
    <ToolPage slug="compare-files">
      <CompareFilesApp />
    </ToolPage>
  );
}
