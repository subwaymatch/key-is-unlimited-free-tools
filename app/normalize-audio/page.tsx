import { ToolPage } from "@/components/ToolPage";
import { NormalizeAudioApp } from "@/components/tools/NormalizeAudioApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("normalize-audio");

export default function Page() {
  return (
    <ToolPage slug="normalize-audio">
      <NormalizeAudioApp />
    </ToolPage>
  );
}
