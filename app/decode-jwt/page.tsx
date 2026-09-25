import { ToolPage } from "@/components/ToolPage";
import { DecodeJwtApp } from "@/components/tools/DecodeJwtApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("decode-jwt");

export default function Page() {
  return (
    <ToolPage slug="decode-jwt">
      <DecodeJwtApp />
    </ToolPage>
  );
}
