import { ToolPage } from "@/components/ToolPage";
import { ExcelToCsvApp } from "@/components/tools/ExcelToCsvApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("excel-to-csv");

export default function Page() {
  return (
    <ToolPage slug="excel-to-csv">
      <ExcelToCsvApp />
    </ToolPage>
  );
}
