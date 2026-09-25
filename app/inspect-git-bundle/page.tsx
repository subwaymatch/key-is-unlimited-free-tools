import { ToolPage } from "@/components/ToolPage";
import { InspectGitBundleApp } from "@/components/tools/InspectGitBundleApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("inspect-git-bundle");

export default function Page() {
  return (
    <ToolPage slug="inspect-git-bundle">
      <InspectGitBundleApp />
    </ToolPage>
  );
}
