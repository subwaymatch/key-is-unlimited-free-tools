import { ToolPage } from "@/components/ToolPage";
import { DecodeProtobufApp } from "@/components/tools/DecodeProtobufApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("decode-protobuf");

export default function Page() {
  return (
    <ToolPage slug="decode-protobuf">
      <DecodeProtobufApp />
    </ToolPage>
  );
}
