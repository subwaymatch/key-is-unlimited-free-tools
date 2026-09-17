import { ToolPage } from "@/components/ToolPage";
import { WatermarkPdfApp } from "@/components/tools/WatermarkPdfApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("watermark-pdf");

export default function Page() {
  return (
    <ToolPage slug="watermark-pdf">
      <WatermarkPdfApp />
    </ToolPage>
  );
}
