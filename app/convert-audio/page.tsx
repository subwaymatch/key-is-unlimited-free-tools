import { ToolPage } from "@/components/ToolPage";
import { ConvertAudioApp } from "@/components/tools/ConvertAudioApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("convert-audio");

export default function Page() {
  return (
    <ToolPage slug="convert-audio">
      <ConvertAudioApp />
    </ToolPage>
  );
}
