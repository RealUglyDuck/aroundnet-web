"use client";

import { CompareViewer } from "@/components/compare/compare-viewer";
import { RequireAuth } from "@/components/require-auth";

// Everything runs client-side against local files (object URLs on two <video>
// elements), so this route works unchanged under the static export.
export default function ComparePage() {
  return (
    <RequireAuth>
      <CompareViewer />
    </RequireAuth>
  );
}
