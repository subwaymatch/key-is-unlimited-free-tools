import { ToolPage } from "@/components/ToolPage";
import { ImagesToPdfApp } from "@/components/tools/ImagesToPdfApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("images-to-pdf");

export default function Page() {
  return (
    <ToolPage slug="images-to-pdf">
      <ImagesToPdfApp />
    </ToolPage>
  );
}
