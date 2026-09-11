import { ToolPage } from "@/components/ToolPage";
import { AudioWaveformApp } from "@/components/tools/AudioWaveformApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("audio-waveform");

export default function Page() {
  return (
    <ToolPage slug="audio-waveform">
      <AudioWaveformApp />
    </ToolPage>
  );
}
