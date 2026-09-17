import { ToolPage } from "@/components/ToolPage";
import { SplitAudioApp } from "@/components/tools/SplitAudioApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("split-audio");

export default function Page() {
  return (
    <ToolPage slug="split-audio">
      <SplitAudioApp />
    </ToolPage>
  );
}
