import { ToolPage } from "@/components/ToolPage";
import { JsonToExcelApp } from "@/components/tools/JsonToExcelApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("json-to-excel");

export default function Page() {
  return (
    <ToolPage slug="json-to-excel">
      <JsonToExcelApp />
    </ToolPage>
  );
}
