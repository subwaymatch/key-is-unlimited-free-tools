import { ToolPage } from "@/components/ToolPage";
import { ConvertGpsApp } from "@/components/tools/ConvertGpsApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("convert-gps");

export default function Page() {
  return (
    <ToolPage slug="convert-gps">
      <ConvertGpsApp />
    </ToolPage>
  );
}
