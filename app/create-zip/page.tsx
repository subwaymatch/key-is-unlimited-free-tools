import { ToolPage } from "@/components/ToolPage";
import { CreateZipApp } from "@/components/tools/CreateZipApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("create-zip");

export default function Page() {
  return (
    <ToolPage slug="create-zip">
      <CreateZipApp />
    </ToolPage>
  );
}
