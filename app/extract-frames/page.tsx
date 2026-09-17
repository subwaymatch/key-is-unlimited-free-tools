import { ToolPage } from "@/components/ToolPage";
import { ExtractFramesApp } from "@/components/tools/ExtractFramesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("extract-frames");

export default function Page() {
  return (
    <ToolPage slug="extract-frames">
      <ExtractFramesApp />
    </ToolPage>
  );
}
