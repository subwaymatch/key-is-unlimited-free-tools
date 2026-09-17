import { ToolPage } from "@/components/ToolPage";
import { ImageToBase64App } from "@/components/tools/ImageToBase64App";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("image-to-base64");

export default function Page() {
  return (
    <ToolPage slug="image-to-base64">
      <ImageToBase64App />
    </ToolPage>
  );
}
