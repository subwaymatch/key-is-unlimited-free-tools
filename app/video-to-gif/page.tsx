import { ToolPage } from "@/components/ToolPage";
import { VideoToGifApp } from "@/components/tools/VideoToGifApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("video-to-gif");

export default function Page() {
  return (
    <ToolPage slug="video-to-gif">
      <VideoToGifApp />
    </ToolPage>
  );
}
