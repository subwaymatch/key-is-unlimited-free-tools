import { ToolPage } from "@/components/ToolPage";
import { ExcelToJsonApp } from "@/components/tools/ExcelToJsonApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("excel-to-json");

export default function Page() {
  return (
    <ToolPage slug="excel-to-json">
      <ExcelToJsonApp />
    </ToolPage>
  );
}
