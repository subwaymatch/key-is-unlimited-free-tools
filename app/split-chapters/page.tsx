import { ToolPage } from "@/components/ToolPage";
import { SplitChaptersApp } from "@/components/tools/SplitChaptersApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("split-chapters");

export default function Page() {
  return (
    <ToolPage slug="split-chapters">
      <SplitChaptersApp />
    </ToolPage>
  );
}
