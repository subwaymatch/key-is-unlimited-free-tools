import { ToolPage } from "@/components/ToolPage";
import { OptimizeGifApp } from "@/components/tools/OptimizeGifApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("optimize-gif");

export default function Page() {
  return (
    <ToolPage slug="optimize-gif">
      <OptimizeGifApp />
    </ToolPage>
  );
}
