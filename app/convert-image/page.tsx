import { ToolPage } from "@/components/ToolPage";
import { ConvertImageApp } from "@/components/tools/ConvertImageApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("convert-image");

export default function Page() {
  return (
    <ToolPage slug="convert-image">
      <ConvertImageApp />
    </ToolPage>
  );
}
