import { ToolPage } from "@/components/ToolPage";
import { AnonymizeCsvApp } from "@/components/tools/AnonymizeCsvApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("anonymize-csv");

export default function Page() {
  return (
    <ToolPage slug="anonymize-csv">
      <AnonymizeCsvApp />
    </ToolPage>
  );
}
