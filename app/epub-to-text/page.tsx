import { ToolPage } from "@/components/ToolPage";
import { EpubToTextApp } from "@/components/tools/EpubToTextApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("epub-to-text");

export default function Page() {
  return (
    <ToolPage slug="epub-to-text">
      <EpubToTextApp />
    </ToolPage>
  );
}
