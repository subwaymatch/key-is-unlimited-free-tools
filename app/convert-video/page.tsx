import { ToolPage } from "@/components/ToolPage";
import { ConvertVideoApp } from "@/components/tools/ConvertVideoApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("convert-video");

export default function Page() {
  return (
    <ToolPage slug="convert-video">
      <ConvertVideoApp />
    </ToolPage>
  );
}
