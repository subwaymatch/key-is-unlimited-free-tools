import { ToolPage } from "@/components/ToolPage";
import { CsvToExcelApp } from "@/components/tools/CsvToExcelApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("csv-to-excel");

export default function Page() {
  return (
    <ToolPage slug="csv-to-excel">
      <CsvToExcelApp />
    </ToolPage>
  );
}
