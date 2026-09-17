import { ToolPage } from "@/components/ToolPage";
import { SyncAudioApp } from "@/components/tools/SyncAudioApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("sync-audio");

export default function Page() {
  return (
    <ToolPage slug="sync-audio">
      <SyncAudioApp />
    </ToolPage>
  );
}
