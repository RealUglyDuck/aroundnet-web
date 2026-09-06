"use client";

import { ReframeEditor } from "@/components/reframe/reframe-editor";
import { RequireAuth } from "@/components/require-auth";

// Everything runs client-side against a local file (WebCodecs + object URLs),
// so this route works unchanged under the static export.
export default function ReframePage() {
  return (
    <RequireAuth>
      <ReframeEditor />
    </RequireAuth>
  );
}
