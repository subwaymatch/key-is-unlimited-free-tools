import { ToolPage } from "@/components/ToolPage";
import { AdjustImageApp } from "@/components/tools/AdjustImageApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("adjust-image");

export default function Page() {
  return (
    <ToolPage slug="adjust-image">
      <AdjustImageApp />
    </ToolPage>
  );
}
