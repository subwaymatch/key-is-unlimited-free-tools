import { ToolPage } from "@/components/ToolPage";
import { PadImageApp } from "@/components/tools/PadImageApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("pad-image");

export default function Page() {
  return (
    <ToolPage slug="pad-image">
      <PadImageApp />
    </ToolPage>
  );
}
