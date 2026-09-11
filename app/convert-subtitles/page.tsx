import { ToolPage } from "@/components/ToolPage";
import { ConvertSubtitlesApp } from "@/components/tools/ConvertSubtitlesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("convert-subtitles");

export default function Page() {
  return (
    <ToolPage slug="convert-subtitles">
      <ConvertSubtitlesApp />
    </ToolPage>
  );
}
