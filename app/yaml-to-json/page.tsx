import { ToolPage } from "@/components/ToolPage";
import { YamlToJsonApp } from "@/components/tools/YamlToJsonApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("yaml-to-json");

export default function Page() {
  return (
    <ToolPage slug="yaml-to-json">
      <YamlToJsonApp />
    </ToolPage>
  );
}
