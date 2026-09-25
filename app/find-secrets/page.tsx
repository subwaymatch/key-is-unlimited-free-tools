import { ToolPage } from "@/components/ToolPage";
import { FindSecretsApp } from "@/components/tools/FindSecretsApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("find-secrets");

export default function Page() {
  return (
    <ToolPage slug="find-secrets">
      <FindSecretsApp />
    </ToolPage>
  );
}
