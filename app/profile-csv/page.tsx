import { ToolPage } from "@/components/ToolPage";
import { ProfileCsvApp } from "@/components/tools/ProfileCsvApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("profile-csv");

export default function Page() {
  return (
    <ToolPage slug="profile-csv">
      <ProfileCsvApp />
    </ToolPage>
  );
}
