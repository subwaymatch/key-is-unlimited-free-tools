import { ToolPage } from "@/components/ToolPage";
import { InspectCertificateApp } from "@/components/tools/InspectCertificateApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("inspect-certificate");

export default function Page() {
  return (
    <ToolPage slug="inspect-certificate">
      <InspectCertificateApp />
    </ToolPage>
  );
}
