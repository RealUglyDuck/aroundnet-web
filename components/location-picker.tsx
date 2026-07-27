"use client";

import * as React from "react";
import { Search, MapPin } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

export interface LocationValue {
  name: string;
  lat: number | null;
  lng: number | null;
}

// Free basemaps (no API key). "Streets" (CARTO Voyager) shows parks as green and
// is best for spotting leisure sites; "Satellite" (Esri) shows actual pitches.
type Basemap = "streets" | "satellite" | "dark";

const raster = (tiles: string[], attribution: string, tileSize = 256) =>
  ({
    version: 8 as const,
    sources: { base: { type: "raster" as const, tiles, tileSize, attribution } },
    layers: [{ id: "base", type: "raster" as const, source: "base" }],
  }) as unknown as import("maplibre-gl").StyleSpecification;

const STYLES: Record<Basemap, import("maplibre-gl").StyleSpecification> = {
  streets: raster(
    [
      "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
      "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
      "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
    ],
    "© OpenStreetMap contributors © CARTO",
  ),
  satellite: raster(
    ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    "Imagery © Esri, Maxar, Earthstar Geographics",
  ),
  dark: raster(
    [
      "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
    ],
    "© OpenStreetMap contributors © CARTO",
  ),
};

const BASEMAP_LABELS: Record<Basemap, string> = {
  streets: "Streets",
  satellite: "Satellite",
  dark: "Dark",
};

interface GeoResult {
  label: string;
  lat: number;
  lng: number;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function LocationPicker({
  value,
  onChange,
}: {
  value: LocationValue;
  onChange: (v: LocationValue) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<import("maplibre-gl").Map | null>(null);
  const markerRef = React.useRef<import("maplibre-gl").Marker | null>(null);
  const glRef = React.useRef<typeof import("maplibre-gl") | null>(null);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = React.useRef(value);
  valueRef.current = value;

  const [results, setResults] = React.useState<GeoResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [basemap, setBasemap] = React.useState<Basemap>("streets");
  const basemapRef = React.useRef(basemap);
  basemapRef.current = basemap;

  const placeMarker = React.useCallback((lat: number, lng: number) => {
    const gl = glRef.current;
    const map = mapRef.current;
    if (!gl || !map) return;
    if (!markerRef.current) {
      const el = document.createElement("div");
      el.className = "an-loc-pin";
      const m = new gl.Marker({ element: el, draggable: true })
        .setLngLat([lng, lat])
        .addTo(map);
      m.on("dragend", () => {
        const p = m.getLngLat();
        onChangeRef.current({ ...valueRef.current, lat: round(p.lat), lng: round(p.lng) });
      });
      markerRef.current = m;
    } else {
      markerRef.current.setLngLat([lng, lat]);
    }
  }, []);

  // Init map once.
  React.useEffect(() => {
    let disposed = false;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      glRef.current = maplibregl;
      if (disposed || !containerRef.current) return;
      const v = valueRef.current;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLES[basemapRef.current],
        center: v.lat != null && v.lng != null ? [v.lng, v.lat] : [12, 54],
        zoom: v.lat != null ? 13 : 3,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("click", (e) => {
        const lat = round(e.lngLat.lat);
        const lng = round(e.lngLat.lng);
        placeMarker(lat, lng);
        onChangeRef.current({ ...valueRef.current, lat, lng });
      });
      mapRef.current = map;
      if (v.lat != null && v.lng != null) placeMarker(v.lat, v.lng);
    })();
    return () => {
      disposed = true;
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [placeMarker]);

  // Switch basemap without re-creating the map (the DOM pin persists across setStyle).
  React.useEffect(() => {
    mapRef.current?.setStyle(STYLES[basemap]);
  }, [basemap]);

  async function search() {
    const q = value.name.trim();
    if (!q) return;
    setSearching(true);
    try {
      // Bias results toward what's currently on screen, so nearby places (e.g.
      // Brixton Recreation Centre in London) rank above far-away namesakes.
      const map = mapRef.current;
      const c = map?.getCenter();
      const bias = c
        ? `&lat=${c.lat}&lon=${c.lng}&zoom=${Math.round(map!.getZoom())}`
        : "";
      const res = await fetch(
        `https://photon.komoot.io/api/?limit=5${bias}&q=${encodeURIComponent(q)}`,
      );
      const data = await res.json();
      const parsed: GeoResult[] = (data.features ?? []).map(
        (f: {
          geometry: { coordinates: [number, number] };
          properties: Record<string, string>;
        }) => {
          const p = f.properties;
          const label = [p.name, p.city ?? p.county, p.state, p.country]
            .filter(Boolean)
            .join(", ");
          return { label, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
        },
      );
      setResults(parsed);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function choose(r: GeoResult) {
    setResults([]);
    // Keep the user's typed name; just move the map + drop the pin there.
    onChangeRef.current({ name: valueRef.current.name || r.label, lat: round(r.lat), lng: round(r.lng) });
    placeMarker(r.lat, r.lng);
    mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: 14 });
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <div className="flex gap-2">
          <Input
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search();
              }
            }}
            placeholder="Search a place, e.g. Clapham Common"
          />
          <Button type="button" variant="secondary" onClick={search} disabled={searching}>
            {searching ? <Spinner /> : <Search size={16} />}
          </Button>
        </div>
        {results.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-small border border-divider bg-surface-high shadow-xl">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => choose(r)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface"
                >
                  <MapPin size={14} className="shrink-0 text-text-secondary" />
                  <span className="truncate">{r.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          className="h-64 w-full overflow-hidden rounded-card border border-divider"
        />
        <div className="absolute left-2 top-2 z-10 flex gap-1 rounded-pill bg-background/80 p-1 backdrop-blur">
          {(Object.keys(STYLES) as Basemap[]).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBasemap(b)}
              className={
                "rounded-pill px-2.5 py-1 text-xs font-medium transition " +
                (basemap === b
                  ? "bg-accent text-background"
                  : "text-text-secondary hover:text-text-primary")
              }
            >
              {BASEMAP_LABELS[b]}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-text-secondary">
        {value.lat != null && value.lng != null ? (
          <>
            Tap or drag the pin to set the exact spot · {value.lat.toFixed(5)},{" "}
            {value.lng.toFixed(5)}
          </>
        ) : (
          <>Search for a place, then tap the map to drop a pin on the exact location.</>
        )}
      </p>

      <style>{`
        .an-loc-pin {
          width: 18px; height: 18px; border-radius: 9999px;
          background: #c7ff00; border: 2px solid #111111;
          box-shadow: 0 0 0 4px rgba(199,255,0,0.25); cursor: grab;
        }
        .maplibregl-ctrl-attrib { background: rgba(30,30,30,0.8); color: #8a8a8a; }
        .maplibregl-ctrl-attrib a { color: #8a8a8a; }
      `}</style>
    </div>
  );
}
