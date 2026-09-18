import { ToolPage } from "@/components/ToolPage";
import { CsvToMarkdownApp } from "@/components/tools/CsvToMarkdownApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("csv-to-markdown");

export default function Page() {
  return (
    <ToolPage slug="csv-to-markdown">
      <CsvToMarkdownApp />
    </ToolPage>
  );
}
