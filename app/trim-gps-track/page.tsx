import { ToolPage } from "@/components/ToolPage";
import { TrimGpsTrackApp } from "@/components/tools/TrimGpsTrackApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("trim-gps-track");

export default function Page() {
  return (
    <ToolPage slug="trim-gps-track">
      <TrimGpsTrackApp />
    </ToolPage>
  );
}
