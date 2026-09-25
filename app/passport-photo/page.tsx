import { ToolPage } from "@/components/ToolPage";
import { PassportPhotoApp } from "@/components/tools/PassportPhotoApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("passport-photo");

export default function Page() {
  return (
    <ToolPage slug="passport-photo">
      <PassportPhotoApp />
    </ToolPage>
  );
}
