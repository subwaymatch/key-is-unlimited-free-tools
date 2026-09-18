import { ToolPage } from "@/components/ToolPage";
import { ResizePdfPagesApp } from "@/components/tools/ResizePdfPagesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("resize-pdf-pages");

export default function Page() {
  return (
    <ToolPage slug="resize-pdf-pages">
      <ResizePdfPagesApp />
    </ToolPage>
  );
}
