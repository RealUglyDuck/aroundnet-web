/**
 * Decorative inline SVG for the landing page. There are no image assets in this
 * repo beyond the app icon, so every visual here is drawn in code.
 *
 * All of these stroke with `currentColor`, so colour comes from a `text-*` class
 * on the wrapper. All are `aria-hidden` — the copy beside them carries the meaning.
 */

const common = {
  "aria-hidden": true,
  className: "h-full w-full",
  fill: "none",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** AR play area: a court in perspective with the net at its centre. */
export function CourtLinesArt() {
  return (
    <svg {...common} viewBox="0 0 320 180" preserveAspectRatio="xMidYMid meet">
      {/* Ground plane in perspective */}
      <path
        d="M160 44 L296 150 L24 150 Z"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="1.5"
      />
      {/* Regulation boundary circle, foreshortened */}
      <ellipse
        cx="160"
        cy="112"
        rx="104"
        ry="34"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="7 6"
      />
      <ellipse
        cx="160"
        cy="112"
        rx="62"
        ry="20"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth="1.5"
      />
      {/* Net */}
      <ellipse cx="160" cy="104" rx="26" ry="9" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="M141 109 L146 120 M179 109 L174 120 M160 113 L160 122"
        stroke="currentColor"
        strokeWidth="2"
      />
      <ellipse
        cx="160"
        cy="122"
        rx="19"
        ry="6"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />
      {/* AR reticle corners */}
      <g stroke="currentColor" strokeOpacity="0.55" strokeWidth="2">
        <path d="M28 42 L28 28 L42 28" />
        <path d="M292 42 L292 28 L278 28" />
        <path d="M28 158 L28 172 L42 172" />
        <path d="M292 158 L292 172 L278 172" />
      </g>
    </svg>
  );
}

/** Reframe: a vertical crop box tracking across a wide frame. */
export function ReframeArt() {
  return (
    <svg {...common} viewBox="0 0 320 180" preserveAspectRatio="xMidYMid meet">
      {/* Source frame */}
      <rect
        x="16"
        y="24"
        width="288"
        height="132"
        rx="6"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="1.5"
      />
      {/* Keyframe path */}
      <path
        d="M74 90 C120 62, 168 118, 226 82"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="1.5"
        strokeDasharray="5 6"
      />
      <g fill="currentColor">
        <circle cx="74" cy="90" r="3.5" fillOpacity="0.6" />
        <circle cx="150" cy="90" r="3.5" fillOpacity="0.6" />
        <circle cx="226" cy="82" r="3.5" fillOpacity="0.6" />
      </g>
      {/* 9:16 output crop, sitting on the middle keyframe */}
      <rect
        x="113"
        y="34"
        width="74"
        height="112"
        rx="4"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path
        d="M113 62 H187 M113 118 H187"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="1"
      />
    </svg>
  );
}

/** Compare: two panes locked to one playhead. */
export function CompareArt() {
  return (
    <svg {...common} viewBox="0 0 320 180" preserveAspectRatio="xMidYMid meet">
      {[24, 172].map((x) => (
        <g key={x}>
          <rect
            x={x}
            y="22"
            width="124"
            height="96"
            rx="6"
            stroke="currentColor"
            strokeOpacity="0.3"
            strokeWidth="1.5"
          />
          {/* A serve: toss arc into contact */}
          <path
            d={`M${x + 30} 100 L${x + 30} 74 L${x + 46} 60 L${x + 62} 72`}
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d={`M${x + 62} 72 C${x + 78} 44, ${x + 96} 44, ${x + 104} 62`}
            stroke="currentColor"
            strokeOpacity="0.45"
            strokeWidth="1.5"
            strokeDasharray="4 5"
          />
          <circle cx={x + 104} cy="62" r="4" fill="currentColor" />
        </g>
      ))}
      {/* One shared scrub track spanning both panes */}
      <path d="M24 142 H296" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M24 142 H166" stroke="currentColor" strokeWidth="3" />
      <circle cx="166" cy="142" r="6" fill="currentColor" />
    </svg>
  );
}

/** Tournaments: a bracket collapsing to one winner. */
export function BracketArt() {
  return (
    <svg {...common} viewBox="0 0 320 180" preserveAspectRatio="xMidYMid meet">
      <g stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5">
        {[30, 62, 118, 150].map((y) => (
          <rect key={y} x="24" y={y} width="60" height="18" rx="4" />
        ))}
      </g>
      <g stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5">
        <path d="M84 39 H108 V71 H84" />
        <path d="M84 127 H108 V159 H84" />
        <path d="M108 55 H140" />
        <path d="M108 143 H140" />
        <rect x="140" y="46" width="60" height="18" rx="4" />
        <rect x="140" y="134" width="60" height="18" rx="4" />
        <path d="M200 55 H224 V143 H200" />
        <path d="M224 99 H248" />
      </g>
      <rect x="248" y="90" width="60" height="18" rx="4" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="278" cy="99" r="3" fill="currentColor" />
    </svg>
  );
}

/** Faint court lines used as hero background texture. */
export function HeroBackdrop() {
  return (
    <svg
      aria-hidden
      className="h-full w-full"
      viewBox="0 0 1200 600"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
    >
      <g stroke="currentColor" strokeWidth="1.5">
        <ellipse cx="600" cy="520" rx="560" ry="150" strokeDasharray="10 10" />
        <ellipse cx="600" cy="520" rx="360" ry="96" strokeOpacity="0.6" />
        <ellipse cx="600" cy="520" rx="170" ry="46" strokeOpacity="0.35" />
      </g>
    </svg>
  );
}
