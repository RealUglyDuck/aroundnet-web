"use client";

import * as React from "react";
import { DEFAULT_GRADE, type ReframeGrade } from "@/lib/reframe/model";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface Props {
  /** The currently loaded video, for the real-file diagnosis. */
  file: File | null;
}

/**
 * `?debug=1` — colour verification the implementer can read as text, because
 * types, lint and build all pass on a shader that produces garbage colour.
 *
 * Two sections:
 * - the GPU-vs-TypeScript ramp self-test for every tone-map shader variant
 *   (validates pass B on this machine's real GPU);
 * - a diagnosis of the loaded file: frame format, colour metadata, raw-plane
 *   (copyTo) availability, the pass-A ground-truth check, and which renderer
 *   the export cascade actually chooses. One screenshot of this settles what
 *   any browser does.
 */
export function ReframeDebugPanel({ file }: Props) {
  const [checks, setChecks] = React.useState<Check[] | null>(null);
  // Keyed by the file so "analysing" is derived, not set synchronously.
  const [diag, setDiag] = React.useState<{ file: File; lines: string[] } | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const { WebglToneMap } = await import("@/lib/reframe/webgl-tonemap");
      const results: Check[] = [];
      const boosted: ReframeGrade = {
        exposure: 0.7,
        contrast: 1.2,
        saturation: 1.3,
        toneMap: "hable",
      };
      for (const transfer of ["hlg", "pq"] as const) {
        for (const toneMap of ["hable", "reinhard"] as const) {
          const glr = WebglToneMap.create({ transfer, toneMap });
          if (!glr) {
            results.push({
              name: `${transfer}/${toneMap}`,
              ok: false,
              detail: "WebGL2 unavailable or shader failed to compile",
            });
            continue;
          }
          try {
            for (const [gradeName, grade] of [
              ["default", { ...DEFAULT_GRADE, toneMap }],
              ["graded", { ...boosted, toneMap }],
            ] as const) {
              const test = glr.selfTest({ transfer, grade });
              results.push({
                name: `ramp ${transfer}/${toneMap}/${gradeName}`,
                ok: test.ok,
                detail: test.detail,
              });
            }
          } finally {
            glr.dispose();
          }
        }
      }
      if (alive) setChecks(results);
    })();
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (!file) return;
    let alive = true;
    (async () => {
      const { diagnoseHdrExport } = await import("@/lib/reframe/frame-renderer");
      const lines = await diagnoseHdrExport(file);
      if (alive) setDiag({ file, lines });
    })();
    return () => {
      alive = false;
    };
  }, [file]);

  const fileLines =
    file === null ? null : diag?.file === file ? diag.lines : ["Analysing the loaded file…"];

  return (
    <div className="space-y-3 rounded-card border border-divider bg-surface p-3">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Colour self-test (GPU vs reference)
        </div>
        {checks === null ? (
          <p className="text-xs text-text-secondary">Running GPU checks…</p>
        ) : (
          <ul className="space-y-1">
            {checks.map((c) => (
              <li key={c.name} className="text-xs">
                <span className={c.ok ? "text-success" : "text-destructive"}>
                  {c.ok ? "PASS" : "FAIL"}
                </span>{" "}
                <span className="font-mono">{c.name}</span>
                <span className="text-text-secondary"> — {c.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Loaded file
        </div>
        {fileLines === null ? (
          <p className="text-xs text-text-secondary">Load a video to diagnose its export path.</p>
        ) : (
          <ul className="space-y-1">
            {fileLines.map((line, i) => (
              <li key={i} className="break-all font-mono text-[11px] leading-snug text-text-secondary">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
