import { ToolPage } from "@/components/ToolPage";
import { LoopVideoApp } from "@/components/tools/LoopVideoApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("loop-video");

export default function Page() {
  return (
    <ToolPage slug="loop-video">
      <LoopVideoApp />
    </ToolPage>
  );
}
