import { ToolPage } from "@/components/ToolPage";
import { CleanNotebookApp } from "@/components/tools/CleanNotebookApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("clean-notebook");

export default function Page() {
  return (
    <ToolPage slug="clean-notebook">
      <CleanNotebookApp />
    </ToolPage>
  );
}
