import { ToolPage } from "@/components/ToolPage";
import { PreviewSiteApp } from "@/components/tools/PreviewSiteApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("preview-site");

export default function Page() {
  return (
    <ToolPage slug="preview-site">
      <PreviewSiteApp />
    </ToolPage>
  );
}
