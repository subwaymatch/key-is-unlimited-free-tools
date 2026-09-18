import { ToolPage } from "@/components/ToolPage";
import { SplitFileApp } from "@/components/tools/SplitFileApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("split-file");

export default function Page() {
  return (
    <ToolPage slug="split-file">
      <SplitFileApp />
    </ToolPage>
  );
}
