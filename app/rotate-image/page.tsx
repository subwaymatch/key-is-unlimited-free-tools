import { ToolPage } from "@/components/ToolPage";
import { RotateImageApp } from "@/components/tools/RotateImageApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("rotate-image");

export default function Page() {
  return (
    <ToolPage slug="rotate-image">
      <RotateImageApp />
    </ToolPage>
  );
}
