import { ToolPage } from "@/components/ToolPage";
import { CompressVideoApp } from "@/components/tools/CompressVideoApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("compress-video");

export default function Page() {
  return (
    <ToolPage slug="compress-video">
      <CompressVideoApp />
    </ToolPage>
  );
}
