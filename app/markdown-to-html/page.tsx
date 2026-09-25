import { ToolPage } from "@/components/ToolPage";
import { MarkdownToHtmlApp } from "@/components/tools/MarkdownToHtmlApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("markdown-to-html");

export default function Page() {
  return (
    <ToolPage slug="markdown-to-html">
      <MarkdownToHtmlApp />
    </ToolPage>
  );
}
