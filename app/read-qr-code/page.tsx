import { ToolPage } from "@/components/ToolPage";
import { ReadQrCodeApp } from "@/components/tools/ReadQrCodeApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("read-qr-code");

export default function Page() {
  return (
    <ToolPage slug="read-qr-code">
      <ReadQrCodeApp />
    </ToolPage>
  );
}
