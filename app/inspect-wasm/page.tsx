import { ToolPage } from "@/components/ToolPage";
import { InspectWasmApp } from "@/components/tools/InspectWasmApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("inspect-wasm");

export default function Page() {
  return (
    <ToolPage slug="inspect-wasm">
      <InspectWasmApp />
    </ToolPage>
  );
}
