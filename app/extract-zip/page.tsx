import { ToolPage } from "@/components/ToolPage";
import { ExtractZipApp } from "@/components/tools/ExtractZipApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("extract-zip");

export default function Page() {
  return (
    <ToolPage slug="extract-zip">
      <ExtractZipApp />
    </ToolPage>
  );
}
