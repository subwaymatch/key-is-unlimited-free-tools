import { ToolPage } from "@/components/ToolPage";
import { AudioToVideoApp } from "@/components/tools/AudioToVideoApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("audio-to-video");

export default function Page() {
  return (
    <ToolPage slug="audio-to-video">
      <AudioToVideoApp />
    </ToolPage>
  );
}
