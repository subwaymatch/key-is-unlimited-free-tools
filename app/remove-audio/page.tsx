import { ToolPage } from "@/components/ToolPage";
import { RemoveAudioApp } from "@/components/tools/RemoveAudioApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("remove-audio");

export default function Page() {
  return (
    <ToolPage slug="remove-audio">
      <RemoveAudioApp />
    </ToolPage>
  );
}
