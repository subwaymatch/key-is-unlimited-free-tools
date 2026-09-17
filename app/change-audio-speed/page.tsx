import { ToolPage } from "@/components/ToolPage";
import { ChangeAudioSpeedApp } from "@/components/tools/ChangeAudioSpeedApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("change-audio-speed");

export default function Page() {
  return (
    <ToolPage slug="change-audio-speed">
      <ChangeAudioSpeedApp />
    </ToolPage>
  );
}
