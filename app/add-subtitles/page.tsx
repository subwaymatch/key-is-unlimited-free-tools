import { ToolPage } from "@/components/ToolPage";
import { AddSubtitlesApp } from "@/components/tools/AddSubtitlesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("add-subtitles");

export default function Page() {
  return (
    <ToolPage slug="add-subtitles">
      <AddSubtitlesApp />
    </ToolPage>
  );
}
