import { ToolPage } from "@/components/ToolPage";
import { AddChaptersApp } from "@/components/tools/AddChaptersApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("add-chapters");

export default function Page() {
  return (
    <ToolPage slug="add-chapters">
      <AddChaptersApp />
    </ToolPage>
  );
}
