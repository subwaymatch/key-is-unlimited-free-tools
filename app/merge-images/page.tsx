import { ToolPage } from "@/components/ToolPage";
import { MergeImagesApp } from "@/components/tools/MergeImagesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("merge-images");

export default function Page() {
  return (
    <ToolPage slug="merge-images">
      <MergeImagesApp />
    </ToolPage>
  );
}
