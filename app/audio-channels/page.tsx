import { ToolPage } from "@/components/ToolPage";
import { AudioChannelsApp } from "@/components/tools/AudioChannelsApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("audio-channels");

export default function Page() {
  return (
    <ToolPage slug="audio-channels">
      <AudioChannelsApp />
    </ToolPage>
  );
}
