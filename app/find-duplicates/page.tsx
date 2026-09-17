import { ToolPage } from "@/components/ToolPage";
import { FindDuplicatesApp } from "@/components/tools/FindDuplicatesApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("find-duplicates");

export default function Page() {
  return (
    <ToolPage slug="find-duplicates">
      <FindDuplicatesApp />
    </ToolPage>
  );
}
