import { ToolPage } from "@/components/ToolPage";
import { VideoThumbnailsApp } from "@/components/tools/VideoThumbnailsApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("video-thumbnails");

export default function Page() {
  return (
    <ToolPage slug="video-thumbnails">
      <VideoThumbnailsApp />
    </ToolPage>
  );
}
