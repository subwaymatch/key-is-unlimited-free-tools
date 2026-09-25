import { ToolPage } from "@/components/ToolPage";
import { EncryptNoteApp } from "@/components/tools/EncryptNoteApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("encrypt-note");

export default function Page() {
  return (
    <ToolPage slug="encrypt-note">
      <EncryptNoteApp />
    </ToolPage>
  );
}
