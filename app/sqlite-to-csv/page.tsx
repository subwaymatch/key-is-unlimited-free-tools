import { ToolPage } from "@/components/ToolPage";
import { SqliteToCsvApp } from "@/components/tools/SqliteToCsvApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("sqlite-to-csv");

export default function Page() {
  return (
    <ToolPage slug="sqlite-to-csv">
      <SqliteToCsvApp />
    </ToolPage>
  );
}
