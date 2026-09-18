import { ToolPage } from "@/components/ToolPage";
import { FlattenPdfApp } from "@/components/tools/FlattenPdfApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("flatten-pdf");

export default function Page() {
  return (
    <ToolPage slug="flatten-pdf">
      <FlattenPdfApp />
    </ToolPage>
  );
}
