import { ToolPage } from "@/components/ToolPage";
import { AddAudioApp } from "@/components/tools/AddAudioApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("add-audio");

export default function Page() {
  return (
    <ToolPage slug="add-audio">
      <AddAudioApp />
    </ToolPage>
  );
}
