import { ToolPage } from "@/components/ToolPage";
import { CleanCsvApp } from "@/components/tools/CleanCsvApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("clean-csv");

export default function Page() {
  return (
    <ToolPage slug="clean-csv">
      <CleanCsvApp />
    </ToolPage>
  );
}
