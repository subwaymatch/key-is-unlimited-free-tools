import { ToolPage } from "@/components/ToolPage";
import { CreateQrCodeApp } from "@/components/tools/CreateQrCodeApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("create-qr-code");

export default function Page() {
  return (
    <ToolPage slug="create-qr-code">
      <CreateQrCodeApp />
    </ToolPage>
  );
}
