import { ToolPage } from "@/components/ToolPage";
import { WatermarkImageApp } from "@/components/tools/WatermarkImageApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("watermark-image");

export default function Page() {
  return (
    <ToolPage slug="watermark-image">
      <WatermarkImageApp />
    </ToolPage>
  );
}
