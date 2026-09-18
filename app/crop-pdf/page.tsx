import { ToolPage } from "@/components/ToolPage";
import { CropPdfApp } from "@/components/tools/CropPdfApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("crop-pdf");

export default function Page() {
  return (
    <ToolPage slug="crop-pdf">
      <CropPdfApp />
    </ToolPage>
  );
}
