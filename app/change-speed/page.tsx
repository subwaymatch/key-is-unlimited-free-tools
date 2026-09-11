import { ToolPage } from "@/components/ToolPage";
import { ChangeSpeedApp } from "@/components/tools/ChangeSpeedApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("change-speed");

export default function Page() {
  return (
    <ToolPage slug="change-speed">
      <ChangeSpeedApp />
    </ToolPage>
  );
}
