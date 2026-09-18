import { ToolPage } from "@/components/ToolPage";
import { SubtitlesToTextApp } from "@/components/tools/SubtitlesToTextApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("subtitles-to-text");

export default function Page() {
  return (
    <ToolPage slug="subtitles-to-text">
      <SubtitlesToTextApp />
    </ToolPage>
  );
}
