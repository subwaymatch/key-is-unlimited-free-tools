import { ToolPage } from "@/components/ToolPage";
import { ConvertTextFileApp } from "@/components/tools/ConvertTextFileApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("convert-text-file");

export default function Page() {
  return (
    <ToolPage slug="convert-text-file">
      <ConvertTextFileApp />
    </ToolPage>
  );
}
