import { ToolPage } from "@/components/ToolPage";
import { NotebookToHtmlApp } from "@/components/tools/NotebookToHtmlApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("notebook-to-html");

export default function Page() {
  return (
    <ToolPage slug="notebook-to-html">
      <NotebookToHtmlApp />
    </ToolPage>
  );
}
