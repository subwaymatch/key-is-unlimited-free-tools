import { ToolPage } from "@/components/ToolPage";
import { AnalyzeLogApp } from "@/components/tools/AnalyzeLogApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("analyze-log");

export default function Page() {
  return (
    <ToolPage slug="analyze-log">
      <AnalyzeLogApp />
    </ToolPage>
  );
}
