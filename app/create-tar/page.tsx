import { ToolPage } from "@/components/ToolPage";
import { CreateTarApp } from "@/components/tools/CreateTarApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("create-tar");

export default function Page() {
  return (
    <ToolPage slug="create-tar">
      <CreateTarApp />
    </ToolPage>
  );
}
