import { ToolPage } from "@/components/ToolPage";
import { AddWatermarkApp } from "@/components/tools/AddWatermarkApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("add-watermark");

export default function Page() {
  return (
    <ToolPage slug="add-watermark">
      <AddWatermarkApp />
    </ToolPage>
  );
}
