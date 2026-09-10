import { ToolPage } from "@/components/ToolPage";
import { TrimVideoApp } from "@/components/tools/TrimVideoApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("trim-video");

export default function Page() {
  return (
    <ToolPage slug="trim-video">
      <TrimVideoApp />
    </ToolPage>
  );
}
