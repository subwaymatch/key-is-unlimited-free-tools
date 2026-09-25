import { ToolPage } from "@/components/ToolPage";
import { MergeGpsApp } from "@/components/tools/MergeGpsApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("merge-gps");

export default function Page() {
  return (
    <ToolPage slug="merge-gps">
      <MergeGpsApp />
    </ToolPage>
  );
}
