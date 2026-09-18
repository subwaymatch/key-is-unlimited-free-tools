import { ToolPage } from "@/components/ToolPage";
import { ConvertCsvApp } from "@/components/tools/ConvertCsvApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("convert-csv");

export default function Page() {
  return (
    <ToolPage slug="convert-csv">
      <ConvertCsvApp />
    </ToolPage>
  );
}
