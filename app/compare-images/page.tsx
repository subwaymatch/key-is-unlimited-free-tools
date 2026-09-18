import { ToolPage } from "@/components/ToolPage";
import { CompareImagesApp } from "@/components/tools/CompareImagesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("compare-images");

export default function Page() {
  return (
    <ToolPage slug="compare-images">
      <CompareImagesApp />
    </ToolPage>
  );
}
