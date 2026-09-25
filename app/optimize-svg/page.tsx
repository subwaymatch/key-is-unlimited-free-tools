import { ToolPage } from "@/components/ToolPage";
import { OptimizeSvgApp } from "@/components/tools/OptimizeSvgApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("optimize-svg");

export default function Page() {
  return (
    <ToolPage slug="optimize-svg">
      <OptimizeSvgApp />
    </ToolPage>
  );
}
