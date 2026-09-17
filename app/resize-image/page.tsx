import { ToolPage } from "@/components/ToolPage";
import { ResizeImageApp } from "@/components/tools/ResizeImageApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("resize-image");

export default function Page() {
  return (
    <ToolPage slug="resize-image">
      <ResizeImageApp />
    </ToolPage>
  );
}
