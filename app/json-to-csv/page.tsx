import { ToolPage } from "@/components/ToolPage";
import { JsonToCsvApp } from "@/components/tools/JsonToCsvApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("json-to-csv");

export default function Page() {
  return (
    <ToolPage slug="json-to-csv">
      <JsonToCsvApp />
    </ToolPage>
  );
}
