import { ToolPage } from "@/components/ToolPage";
import { Convert3dModelApp } from "@/components/tools/Convert3dModelApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("convert-3d-model");

export default function Page() {
  return (
    <ToolPage slug="convert-3d-model">
      <Convert3dModelApp />
    </ToolPage>
  );
}
