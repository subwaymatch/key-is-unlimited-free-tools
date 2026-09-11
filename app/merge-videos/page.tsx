import { ToolPage } from "@/components/ToolPage";
import { MergeVideosApp } from "@/components/tools/MergeVideosApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("merge-videos");

export default function Page() {
  return (
    <ToolPage slug="merge-videos">
      <MergeVideosApp />
    </ToolPage>
  );
}
