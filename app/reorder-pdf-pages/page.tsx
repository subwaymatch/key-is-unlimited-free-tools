import { ToolPage } from "@/components/ToolPage";
import { ReorderPdfPagesApp } from "@/components/tools/ReorderPdfPagesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("reorder-pdf-pages");

export default function Page() {
  return (
    <ToolPage slug="reorder-pdf-pages">
      <ReorderPdfPagesApp />
    </ToolPage>
  );
}
