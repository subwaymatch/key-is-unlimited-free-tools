import { ToolPage } from "@/components/ToolPage";
import { AddPageNumbersApp } from "@/components/tools/AddPageNumbersApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("add-page-numbers");

export default function Page() {
  return (
    <ToolPage slug="add-page-numbers">
      <AddPageNumbersApp />
    </ToolPage>
  );
}
