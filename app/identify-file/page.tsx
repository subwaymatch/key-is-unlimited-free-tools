import { ToolPage } from "@/components/ToolPage";
import { IdentifyFileApp } from "@/components/tools/IdentifyFileApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("identify-file");

export default function Page() {
  return (
    <ToolPage slug="identify-file">
      <IdentifyFileApp />
    </ToolPage>
  );
}
