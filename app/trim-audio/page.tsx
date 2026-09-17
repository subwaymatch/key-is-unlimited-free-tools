import { ToolPage } from "@/components/ToolPage";
import { TrimAudioApp } from "@/components/tools/TrimAudioApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("trim-audio");

export default function Page() {
  return (
    <ToolPage slug="trim-audio">
      <TrimAudioApp />
    </ToolPage>
  );
}
