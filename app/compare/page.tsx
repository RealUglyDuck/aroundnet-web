"use client";

import { CompareViewer } from "@/components/compare/compare-viewer";

// Everything runs client-side against local files (object URLs on two <video>
// elements), so this route works unchanged under the static export.
export default function ComparePage() {
  return <CompareViewer />;
}
