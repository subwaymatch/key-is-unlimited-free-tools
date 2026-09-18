import { ToolPage } from "@/components/ToolPage";
import { RoundImageApp } from "@/components/tools/RoundImageApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("round-image");

export default function Page() {
  return (
    <ToolPage slug="round-image">
      <RoundImageApp />
    </ToolPage>
  );
}
