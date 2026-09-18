import { ToolPage } from "@/components/ToolPage";
import { ExtractTarApp } from "@/components/tools/ExtractTarApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("extract-tar");

export default function Page() {
  return (
    <ToolPage slug="extract-tar">
      <ExtractTarApp />
    </ToolPage>
  );
}
