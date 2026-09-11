import { ToolPage } from "@/components/ToolPage";
import { CompressAudioApp } from "@/components/tools/CompressAudioApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("compress-audio");

export default function Page() {
  return (
    <ToolPage slug="compress-audio">
      <CompressAudioApp />
    </ToolPage>
  );
}
