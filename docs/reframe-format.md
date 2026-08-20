# Reframe document format (v1)

A *reframe document* describes how a landscape clip is cropped into a vertical
one over time. It is deliberately small, resolution-independent and free of any
web-specific concepts, so the same document can drive the web editor
(`/reframe`), a future ARoundNet iOS implementation, or a server-side renderer.

The web implementation lives in `lib/reframe/` — `model.ts` (types + document
operations) and `solve.ts` (the math) are dependency-free and DOM-free on
purpose. Port those two files and you have a compatible implementation.

## The document

```jsonc
{
  "version": 1,
  "source": {
    "width": 1920,          // display pixels, after rotation & pixel-aspect
    "height": 1080,
    "duration": 42.7,       // seconds
    "name": "serve-drill.mp4",
    "frameRate": 59.94      // optional; measured, not read from metadata
  },
  "target": { "width": 1080, "height": 1920 },
  "keyframes": [
    { "id": "kf1_ab3xz", "t": 0.0,  "cx": 0.31, "cy": 0.5, "zoom": 1, "easing": "easeInOut" },
    { "id": "kf2_9qm2p", "t": 3.5,  "cx": 0.72, "cy": 0.5, "zoom": 1, "easing": "hold" },
    { "id": "kf3_k1w8d", "t": 6.0,  "cx": 0.72, "cy": 0.5, "zoom": 1.4, "easing": "linear" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `t` | Seconds from the start of the source. Keyframes are sorted ascending. |
| `cx`, `cy` | Centre of the crop window, normalised 0–1 in **source** coordinates. Resolution-independent, so a document survives a re-encode. |
| `zoom` | `1` = the largest target-aspect rect that fits in the source. `2` = a 2× punch-in. Always ≥ 1. |
| `easing` | Governs the segment **from this keyframe to the next**. The last keyframe's easing is meaningless. |
| `id` | Editor-local only. Not meaningful across documents; regenerate freely. |

`easing` is one of:

- `easeInOut` — smoothstep, `u²(3−2u)`. Zero velocity at both ends, so the pan
  settles on each keyframe instead of cornering through it. The default.
- `linear` — constant velocity.
- `hold` — no motion; the crop stays put and jumps at the next keyframe.

## The math

Three steps, in this order. Order matters — see the note on clamping.

**1. Crop extent.** The largest target-aspect rect that fits inside the source,
divided by zoom:

```
targetAspect = target.width / target.height
maxWidth     = min(source.width, source.height * targetAspect)
maxHeight    = maxWidth / targetAspect

cropWidth  = maxWidth  / max(1, zoom)
cropHeight = maxHeight / max(1, zoom)
```

For 1920×1080 → 1080×1920 at zoom 1 this is 607.5 × 1080: full height, 31.6%
of the width. Note the consequence: **at zoom 1 there is no vertical freedom**,
so `cy` is pinned to 0.5 and only horizontal taps move anything. Vertical
motion only becomes possible once you zoom in.

**2. Interpolate.** Piecewise between the two surrounding keyframes, on `cx`,
`cy` and `zoom` independently. Outside the keyframe range the nearest keyframe
is held — so one keyframe means a static crop, and zero keyframes means dead
centre.

```
u = (t - a.t) / (b.t - a.t)
e = ease(a.easing, u)
value = a.value + (b.value - a.value) * e
```

**3. Clamp.** Pull the centre back inside the source frame. This is the
"stop at the edge rather than showing black bars" rule:

```
halfW = (cropWidth  / source.width)  / 2
halfH = (cropHeight / source.height) / 2
cx = halfW >= 0.5 ? 0.5 : clamp(cx, halfW, 1 - halfW)
cy = halfH >= 0.5 ? 0.5 : clamp(cy, halfH, 1 - halfH)
```

> **Clamp after interpolating, not only when editing.** The editor also clamps
> at edit time so the stored values are honest, but that is not sufficient: when
> `zoom` animates, a centre that is legal at both ends of a segment can still
> leave the frame in the middle of it. `solve.ts` clamps in both places, and
> the test in `solve.test` sweeps an animated-zoom pan to prove the rect never
> escapes the source.

The final rect, in source pixels:

```
x = cx * source.width  - cropWidth  / 2
y = cy * source.height - cropHeight / 2
```

## Porting to Swift (ARoundNet)

### The model

`ReframeDoc` maps to `Codable` structs one-to-one. `easing` becomes a
`String`-backed enum. Everything else is `Double`.

```swift
struct ReframeDoc: Codable {
    let version: Int
    var source: ReframeSource
    var target: ReframeTarget
    var keyframes: [ReframeKeyframe]
}

enum ReframeEasing: String, Codable { case easeInOut, linear, hold }
```

Port `solve.ts` verbatim into a `ReframeSolver` — it is 60 lines of arithmetic
with no platform dependencies, and keeping it a literal translation is what
makes "the same document renders the same on both platforms" checkable.

### Live preview

Overlay the crop rect on the player using `solveCrop(doc, t)` normalised into
the view's coordinate space, exactly as `reframe-stage.tsx` does. Drive the
overlay from an `AVPlayer` periodic time observer at ~30 Hz; `addPeriodicTimeObserver`
with an interval of `CMTime(value: 1, timescale: 30)` is enough for it to look
attached to the video.

### Export

Two viable routes:

**a) `AVVideoComposition(asset:applyingCIFiltersWithHandler:)` — recommended.**
You get the exact composition time for every frame, so the eased curve is
reproduced precisely with no approximation:

```swift
let composition = AVVideoComposition(asset: asset) { request in
    let t = request.compositionTime.seconds
    let crop = solver.crop(at: t)                    // in source pixels
    let scale = CGFloat(doc.target.width) / crop.width

    // CoreImage's origin is bottom-left; the document's is top-left.
    let flippedY = doc.source.height - crop.origin.y - crop.height

    let output = request.sourceImage
        .cropped(to: CGRect(x: crop.origin.x, y: flippedY,
                            width: crop.width, height: crop.height))
        .transformed(by: CGAffineTransform(translationX: -crop.origin.x,
                                           y: -flippedY))
        .transformed(by: CGAffineTransform(scaleX: scale, y: scale))

    request.finish(with: output, context: nil)
}
composition.renderSize = CGSize(width: doc.target.width, height: doc.target.height)
```

Then feed it to `AVAssetExportSession` via `videoComposition`, in the same shape
as the existing `VideoExportService.exportSegment`. Audio comes across
untouched, as it does today.

**b) `AVMutableVideoCompositionLayerInstruction` transform ramps.** Cheaper on
the GPU, but `setTransformRamp(fromStart:toEnd:timeRange:)` only interpolates
*linearly*, so an `easeInOut` segment has to be approximated by a chain of short
ramps sampled along the eased curve (every 2–3 frames is imperceptible). The
transform for a crop rect is:

```swift
let scale = CGFloat(doc.target.width) / crop.width
let transform = CGAffineTransform(translationX: -crop.origin.x * scale,
                                  y: -crop.origin.y * scale)
    .scaledBy(x: scale, y: scale)   // scale is applied first, then the translate
```

Apply the track's `preferredTransform` before this if the source is rotated.

Prefer (a) unless profiling says otherwise; (b) exists mainly because it avoids
a CoreImage round-trip per frame on older devices.

## Web implementation notes

- Export is `lib/reframe/export.ts`, built on [mediabunny](https://mediabunny.dev):
  demux → WebCodecs decode → crop-draw to an `OffscreenCanvas` → AVC encode →
  MP4 mux. Both the exporter and the on-screen preview call the same
  `solveCrop`, so the preview is genuinely WYSIWYG.
- Audio is **copied packet-for-packet**, not decoded and re-encoded — free and
  lossless. It is dropped only when the source codec is illegal inside MP4
  (Opus in a WebM, say).
- The whole output is buffered in memory (`BufferTarget` + `fastStart:
  'in-memory'`). Fine for clips; a feature-length source would want a
  `StreamTarget` writing to the File System Access API instead.
- Needs WebCodecs: Chrome, Edge, or Safari 16.4+. `checkExportSupport()` probes
  for it and the export panel disables itself with a reason when it is missing.
