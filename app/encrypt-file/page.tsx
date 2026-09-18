import { ToolPage } from "@/components/ToolPage";
import { EncryptFileApp } from "@/components/tools/EncryptFileApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("encrypt-file");

export default function Page() {
  return (
    <ToolPage slug="encrypt-file">
      <EncryptFileApp />
    </ToolPage>
  );
}
