import { AudioExtractorApp } from "@/components/AudioExtractorApp";
import { ToolPage } from "@/components/ToolPage";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("extract-audio");

export default function Page() {
  return (
    <ToolPage slug="extract-audio">
      <AudioExtractorApp />
    </ToolPage>
  );
}
