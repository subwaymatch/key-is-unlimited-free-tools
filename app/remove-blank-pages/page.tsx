import { ToolPage } from "@/components/ToolPage";
import { RemoveBlankPagesApp } from "@/components/tools/RemoveBlankPagesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("remove-blank-pages");

export default function Page() {
  return (
    <ToolPage slug="remove-blank-pages">
      <RemoveBlankPagesApp />
    </ToolPage>
  );
}
