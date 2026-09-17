import { ToolPage } from "@/components/ToolPage";
import { ChecksumApp } from "@/components/tools/ChecksumApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("checksum");

export default function Page() {
  return (
    <ToolPage slug="checksum">
      <ChecksumApp />
    </ToolPage>
  );
}
