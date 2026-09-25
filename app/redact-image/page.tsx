import { ToolPage } from "@/components/ToolPage";
import { RedactImageApp } from "@/components/tools/RedactImageApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("redact-image");

export default function Page() {
  return (
    <ToolPage slug="redact-image">
      <RedactImageApp />
    </ToolPage>
  );
}
