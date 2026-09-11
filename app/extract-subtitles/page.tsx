import { ToolPage } from "@/components/ToolPage";
import { ExtractSubtitlesApp } from "@/components/tools/ExtractSubtitlesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("extract-subtitles");

export default function Page() {
  return (
    <ToolPage slug="extract-subtitles">
      <ExtractSubtitlesApp />
    </ToolPage>
  );
}
