import { ToolPage } from "@/components/ToolPage";
import { ChangeVolumeApp } from "@/components/tools/ChangeVolumeApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("change-volume");

export default function Page() {
  return (
    <ToolPage slug="change-volume">
      <ChangeVolumeApp />
    </ToolPage>
  );
}
