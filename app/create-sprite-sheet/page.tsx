import { ToolPage } from "@/components/ToolPage";
import { CreateSpriteSheetApp } from "@/components/tools/CreateSpriteSheetApp";
import { toolMetadata } from "@/lib/tools";

export const metadata = toolMetadata("create-sprite-sheet");

export default function Page() {
  return (
    <ToolPage slug="create-sprite-sheet">
      <CreateSpriteSheetApp />
    </ToolPage>
  );
}
