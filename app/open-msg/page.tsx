import { ToolPage } from "@/components/ToolPage";
import { OpenMsgApp } from "@/components/tools/OpenMsgApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("open-msg");

export default function Page() {
  return (
    <ToolPage slug="open-msg">
      <OpenMsgApp />
    </ToolPage>
  );
}
