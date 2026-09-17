import { ToolPage } from "@/components/ToolPage";
import { CompressImageApp } from "@/components/tools/CompressImageApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("compress-image");

export default function Page() {
  return (
    <ToolPage slug="compress-image">
      <CompressImageApp />
    </ToolPage>
  );
}
