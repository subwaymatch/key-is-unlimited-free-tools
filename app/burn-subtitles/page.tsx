import { ToolPage } from "@/components/ToolPage";
import { BurnSubtitlesApp } from "@/components/tools/BurnSubtitlesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("burn-subtitles");

export default function Page() {
  return (
    <ToolPage slug="burn-subtitles">
      <BurnSubtitlesApp />
    </ToolPage>
  );
}
