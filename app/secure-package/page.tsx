import { ToolPage } from "@/components/ToolPage";
import { SecurePackageApp } from "@/components/tools/SecurePackageApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("secure-package");

export default function Page() {
  return (
    <ToolPage slug="secure-package">
      <SecurePackageApp />
    </ToolPage>
  );
}
