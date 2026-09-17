import { ToolPage } from "@/components/ToolPage";
import { SplitVideoApp } from "@/components/tools/SplitVideoApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("split-video");

export default function Page() {
  return (
    <ToolPage slug="split-video">
      <SplitVideoApp />
    </ToolPage>
  );
}
