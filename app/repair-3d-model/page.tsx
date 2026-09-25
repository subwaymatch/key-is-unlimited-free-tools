import { ToolPage } from "@/components/ToolPage";
import { Repair3dModelApp } from "@/components/tools/Repair3dModelApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("repair-3d-model");

export default function Page() {
  return (
    <ToolPage slug="repair-3d-model">
      <Repair3dModelApp />
    </ToolPage>
  );
}
