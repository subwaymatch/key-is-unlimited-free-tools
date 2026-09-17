import { ToolPage } from "@/components/ToolPage";
import { MergeAudioApp } from "@/components/tools/MergeAudioApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("merge-audio");

export default function Page() {
  return (
    <ToolPage slug="merge-audio">
      <MergeAudioApp />
    </ToolPage>
  );
}
