import { ToolPage } from "@/components/ToolPage";
import { CropImageApp } from "@/components/tools/CropImageApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("crop-image");

export default function Page() {
  return (
    <ToolPage slug="crop-image">
      <CropImageApp />
    </ToolPage>
  );
}
