"use client";

import * as React from "react";
import { ReframeEditor } from "@/components/reframe/reframe-editor";
import { RequireAuth } from "@/components/require-auth";

/**
 * Where the editor is usable at all.
 *
 * Width alone is not the test: an iPad in landscape is wide enough and still
 * has no keyboard. A coarse primary pointer catches those, and reports `fine`
 * on a touchscreen laptop being driven by its trackpad, which is the case we
 * want to let through.
 */
const TOO_SMALL = "(max-width: 1023px), (pointer: coarse)";

// Everything runs client-side against a local file (WebCodecs + object URLs),
// so this route works unchanged under the static export.
export default function ReframePage() {
  // Null until measured, so a phone never gets a frame of the editor first.
  // `RequireAuth` renders a spinner until auth resolves anyway, so nothing is
  // waiting on this.
  const [tooSmall, setTooSmall] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    const query = window.matchMedia(TOO_SMALL);
    const sync = () => setTooSmall(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return (
    <RequireAuth>
      {tooSmall === null ? null : tooSmall ? <DesktopOnlyNotice /> : <ReframeEditor />}
    </RequireAuth>
  );
}

/**
 * Deliberately not a "continue anyway" escape hatch: the clip loads and plays
 * fine on a phone, so the editor looks like it works right up until there is
 * no way to mark a segment or place a keyframe.
 */
function DesktopOnlyNotice() {
  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="text-xl font-semibold">Reframe</h1>
      <div className="mt-4 rounded-card border border-divider bg-surface p-4">
        <p className="text-sm font-medium">Desktop browser only, for now</p>
        <p className="mt-2 text-sm text-text-secondary">
          Marking segments, dropping keyframes and stepping through footage are all
          keyboard shortcuts, so there is nothing to press on a phone or tablet. Open
          this page on a computer and the editor is here waiting.
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          Anything you have already saved is safe — edits are stored against the clip,
          not the device.
        </p>
      </div>
    </div>
  );
}
