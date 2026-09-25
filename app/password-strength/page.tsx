import { ToolPage } from "@/components/ToolPage";
import { PasswordStrengthApp } from "@/components/tools/PasswordStrengthApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("password-strength");

export default function Page() {
  return (
    <ToolPage slug="password-strength">
      <PasswordStrengthApp />
    </ToolPage>
  );
}
