import { ToolPage } from "@/components/ToolPage";
import { SvgToPngApp } from "@/components/tools/SvgToPngApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("svg-to-png");

export default function Page() {
  return (
    <ToolPage slug="svg-to-png">
      <SvgToPngApp />
    </ToolPage>
  );
}
