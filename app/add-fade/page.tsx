import { ToolPage } from "@/components/ToolPage";
import { AddFadeApp } from "@/components/tools/AddFadeApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("add-fade");

export default function Page() {
  return (
    <ToolPage slug="add-fade">
      <AddFadeApp />
    </ToolPage>
  );
}
