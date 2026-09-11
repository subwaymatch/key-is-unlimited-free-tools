import { ToolPage } from "@/components/ToolPage";
import { MergeSubtitlesApp } from "@/components/tools/MergeSubtitlesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("merge-subtitles");

export default function Page() {
  return (
    <ToolPage slug="merge-subtitles">
      <MergeSubtitlesApp />
    </ToolPage>
  );
}
