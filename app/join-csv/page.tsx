import { ToolPage } from "@/components/ToolPage";
import { JoinCsvApp } from "@/components/tools/JoinCsvApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("join-csv");

export default function Page() {
  return (
    <ToolPage slug="join-csv">
      <JoinCsvApp />
    </ToolPage>
  );
}
