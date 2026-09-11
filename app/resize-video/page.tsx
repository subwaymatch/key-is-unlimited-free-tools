import { ToolPage } from "@/components/ToolPage";
import { ResizeVideoApp } from "@/components/tools/ResizeVideoApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("resize-video");

export default function Page() {
  return (
    <ToolPage slug="resize-video">
      <ResizeVideoApp />
    </ToolPage>
  );
}
