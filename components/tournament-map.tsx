"use client";

import * as React from "react";
import "maplibre-gl/dist/maplibre-gl.css";

export interface MapPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

// Free dark raster basemap (CARTO dark_all) — no API key required. Matches #111.
const DARK_STYLE = {
  version: 8 as const,
  sources: {
    carto: {
      type: "raster" as const,
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [{ id: "carto", type: "raster" as const, source: "carto" }],
};

export function TournamentMap({
  points,
  onSelect,
  className,
}: {
  points: MapPoint[];
  onSelect?: (id: string) => void;
  className?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<unknown>(null);
  // Keep latest callback without re-initialising the map.
  const onSelectRef = React.useRef(onSelect);
  onSelectRef.current = onSelect;

  React.useEffect(() => {
    let map: import("maplibre-gl").Map | null = null;
    let markers: import("maplibre-gl").Marker[] = [];
    let disposed = false;

    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (disposed || !containerRef.current) return;

      map = new maplibregl.Map({
        container: containerRef.current,
        style: DARK_STYLE as unknown as import("maplibre-gl").StyleSpecification,
        center: [12, 60], // Scandinavia
        zoom: 3.4,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      mapRef.current = map;

      const withCoords = points.filter((p) => p.lat != null && p.lng != null);
      for (const p of withCoords) {
        const el = document.createElement("button");
        el.className = "an-map-pin";
        el.title = p.name;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelectRef.current?.(p.id);
        });
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([p.lng, p.lat])
          .addTo(map);
        markers.push(marker);
      }

      if (withCoords.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        withCoords.forEach((p) => bounds.extend([p.lng, p.lat]));
        map.fitBounds(bounds, { padding: 60, maxZoom: 9, duration: 0 });
      } else if (withCoords.length === 1) {
        map.setCenter([withCoords[0].lng, withCoords[0].lat]);
        map.setZoom(9);
      }
    })();

    return () => {
      disposed = true;
      markers.forEach((m) => m.remove());
      map?.remove();
      mapRef.current = null;
    };
  }, [points]);

  return (
    <>
      <div ref={containerRef} className={className} />
      <style>{`
        .an-map-pin {
          width: 16px; height: 16px; border-radius: 9999px;
          background: #c7ff00; border: 2px solid #111111;
          box-shadow: 0 0 0 4px rgba(199,255,0,0.25); cursor: pointer; padding: 0;
        }
        .maplibregl-ctrl-attrib { background: rgba(30,30,30,0.8); color: #8a8a8a; }
        .maplibregl-ctrl-attrib a { color: #8a8a8a; }
      `}</style>
    </>
  );
}
