import { ToolPage } from "@/components/ToolPage";
import { XmlToJsonApp } from "@/components/tools/XmlToJsonApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("xml-to-json");

export default function Page() {
  return (
    <ToolPage slug="xml-to-json">
      <XmlToJsonApp />
    </ToolPage>
  );
}
