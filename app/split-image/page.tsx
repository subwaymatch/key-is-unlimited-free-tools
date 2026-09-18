import { ToolPage } from "@/components/ToolPage";
import { SplitImageApp } from "@/components/tools/SplitImageApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("split-image");

export default function Page() {
  return (
    <ToolPage slug="split-image">
      <SplitImageApp />
    </ToolPage>
  );
}
