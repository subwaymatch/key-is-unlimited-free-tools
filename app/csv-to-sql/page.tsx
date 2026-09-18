import { ToolPage } from "@/components/ToolPage";
import { CsvToSqlApp } from "@/components/tools/CsvToSqlApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("csv-to-sql");

export default function Page() {
  return (
    <ToolPage slug="csv-to-sql">
      <CsvToSqlApp />
    </ToolPage>
  );
}
