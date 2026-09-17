import { ToolPage } from "@/components/ToolPage";
import { GifToVideoApp } from "@/components/tools/GifToVideoApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("gif-to-video");

export default function Page() {
  return (
    <ToolPage slug="gif-to-video">
      <GifToVideoApp />
    </ToolPage>
  );
}
