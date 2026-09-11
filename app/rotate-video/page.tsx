import { ToolPage } from "@/components/ToolPage";
import { RotateVideoApp } from "@/components/tools/RotateVideoApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("rotate-video");

export default function Page() {
  return (
    <ToolPage slug="rotate-video">
      <RotateVideoApp />
    </ToolPage>
  );
}
