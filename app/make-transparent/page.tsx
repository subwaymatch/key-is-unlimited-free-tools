import { ToolPage } from "@/components/ToolPage";
import { MakeTransparentApp } from "@/components/tools/MakeTransparentApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("make-transparent");

export default function Page() {
  return (
    <ToolPage slug="make-transparent">
      <MakeTransparentApp />
    </ToolPage>
  );
}
