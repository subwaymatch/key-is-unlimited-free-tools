import { ToolPage } from "@/components/ToolPage";
import { FormatXmlApp } from "@/components/tools/FormatXmlApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("format-xml");

export default function Page() {
  return (
    <ToolPage slug="format-xml">
      <FormatXmlApp />
    </ToolPage>
  );
}
