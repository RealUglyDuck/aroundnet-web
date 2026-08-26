"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import {
  DEFAULT_GRADE,
  gradeOf,
  TONE_MAPS,
  type ReframeDoc,
  type ReframeGrade,
  type ReframeToneMap,
} from "@/lib/reframe/model";

interface Props {
  doc: ReframeDoc;
  /**
   * `first` is true on the first change of a slider gesture — the editor
   * pushes one undo entry there and treats the rest as transient, the same
   * discipline moveKeyframe uses.
   */
  onChangeGrade: (patch: Partial<ReframeGrade>, first: boolean) => void;
}

const TONE_MAP_LABEL: Record<ReframeToneMap, string> = {
  hable: "Filmic (Hable)",
  reinhard: "Reinhard",
  none: "None (browser)",
};

/**
 * One labelled slider following the inspector's idiom, with per-gesture
 * history: a drag or a held arrow key is one undo step, not fifty.
 */
function GradeSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number, first: boolean) => void;
}) {
  const inGestureRef = React.useRef(false);
  const end = () => {
    inGestureRef.current = false;
  };
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-mono text-xs text-text-secondary">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const first = !inGestureRef.current;
          inGestureRef.current = true;
          onChange(Number(e.target.value), first);
        }}
        onPointerUp={end}
        onKeyUp={end}
        onBlur={end}
        className="w-full accent-accent"
      />
    </div>
  );
}

function ReframeGradePanelInner({ doc, onChangeGrade }: Props) {
  const grade = gradeOf(doc);
  const isHdr = doc.source.hdr === true;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Colour
        </span>
        {isHdr && (
          <span className="rounded-pill bg-accent-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
            HDR{doc.source.colorSpace?.includes("hlg") ? " · HLG" : ""}
          </span>
        )}
      </div>

      <GradeSlider
        label="Exposure"
        value={grade.exposure}
        min={-2}
        max={2}
        step={0.05}
        format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} ev`}
        onChange={(exposure, first) => onChangeGrade({ exposure }, first)}
      />
      <GradeSlider
        label="Contrast"
        value={grade.contrast}
        min={0.5}
        max={1.5}
        step={0.01}
        format={(v) => v.toFixed(2)}
        onChange={(contrast, first) => onChangeGrade({ contrast }, first)}
      />
      <GradeSlider
        label="Saturation"
        value={grade.saturation}
        min={0}
        max={2}
        step={0.01}
        format={(v) => v.toFixed(2)}
        onChange={(saturation, first) => onChangeGrade({ saturation }, first)}
      />

      {isHdr && (
        <div>
          <div className="mb-1.5 text-sm font-medium">Tone map</div>
          <Select
            aria-label="HDR tone map"
            value={grade.toneMap}
            onChange={(e) => onChangeGrade({ toneMap: e.target.value as ReframeToneMap }, true)}
            className="w-full py-2 text-sm"
          >
            {TONE_MAPS.map((t) => (
              <option key={t} value={t}>
                {TONE_MAP_LABEL[t]}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-text-secondary">
            Applied at export. &ldquo;None&rdquo; keeps the browser&rsquo;s own conversion.
          </p>
        </div>
      )}

      {doc.grade && (
        <Button
          variant="secondary"
          size="sm"
          fullWidth
          onClick={() => onChangeGrade({ ...DEFAULT_GRADE }, true)}
        >
          Reset colour
        </Button>
      )}
    </div>
  );
}

// The editor re-renders on every playhead tick; nothing here depends on it.
export const ReframeGradePanel = React.memo(ReframeGradePanelInner);
