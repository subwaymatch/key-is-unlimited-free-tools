import { ToolPage } from "@/components/ToolPage";
import { ExtractAudioTracksApp } from "@/components/tools/ExtractAudioTracksApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("extract-audio-tracks");

export default function Page() {
  return (
    <ToolPage slug="extract-audio-tracks">
      <ExtractAudioTracksApp />
    </ToolPage>
  );
}
