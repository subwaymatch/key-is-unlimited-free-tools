import { ToolPage } from "@/components/ToolPage";
import { DeletePdfPagesApp } from "@/components/tools/DeletePdfPagesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("delete-pdf-pages");

export default function Page() {
  return (
    <ToolPage slug="delete-pdf-pages">
      <DeletePdfPagesApp />
    </ToolPage>
  );
}
