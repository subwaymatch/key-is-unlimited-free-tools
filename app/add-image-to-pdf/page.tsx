import { ToolPage } from "@/components/ToolPage";
import { AddImageToPdfApp } from "@/components/tools/AddImageToPdfApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("add-image-to-pdf");

export default function Page() {
  return (
    <ToolPage slug="add-image-to-pdf">
      <AddImageToPdfApp />
    </ToolPage>
  );
}
