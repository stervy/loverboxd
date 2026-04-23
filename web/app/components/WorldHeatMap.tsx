"use client";

/**
 * Zero-dep world heat map. Fetches GeoJSON (johan/world.geo.json) from
 * jsDelivr at runtime, rather than committing ~250KB of geometry into the
 * repo. Projection is plain equirectangular — good enough for a stats chart,
 * not a navigation map.
 *
 * Country names come from Letterboxd (`/films/country/*` link text). Most
 * names match the GeoJSON `properties.name` directly; NAME_ALIASES below
 * covers the handful that don't (USA→United States of America, etc.).
 */

import { useEffect, useMemo, useState } from "react";

const GEOJSON_URL =
  "https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json";

// Letterboxd display-name → GeoJSON `properties.name`. Only the cases where
// the two differ need listing; everything else matches case-insensitively.
const NAME_ALIASES: Record<string, string> = {
  USA: "United States of America",
  "United States": "United States of America",
  UK: "United Kingdom",
  "Republic of Ireland": "Ireland",
  "Bosnia and Herzegovina": "Bosnia and Herzegovina",
  "Macedonia": "Macedonia",
  "Republic of Macedonia": "Macedonia",
  Serbia: "Republic of Serbia",
  Tanzania: "United Republic of Tanzania",
  Bahamas: "The Bahamas",
  "Hong Kong": "Hong Kong S.A.R.",
  Macau: "Macau S.A.R",
  Palestine: "West Bank",
  "East Timor": "East Timor",
  "Republic of the Congo": "Republic of Congo",
  "Democratic Republic of the Congo": "Democratic Republic of the Congo",
  "Côte d'Ivoire": "Ivory Coast",
  Czechia: "Czech Republic",
  Eswatini: "Swaziland",
};

type Geometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

type GeoFeature = {
  type: "Feature";
  properties: { name: string };
  geometry: Geometry;
};

const VIEW_W = 1000;
const VIEW_H = 500;

function project(lon: number, lat: number): [number, number] {
  return [((lon + 180) / 360) * VIEW_W, ((90 - lat) / 180) * VIEW_H];
}

function ringToPath(ring: number[][]): string {
  let d = "";
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = project(ring[i][0], ring[i][1]);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)} `;
  }
  return d + "Z";
}

function featurePath(f: GeoFeature): string {
  if (f.geometry.type === "Polygon") {
    return f.geometry.coordinates.map(ringToPath).join(" ");
  }
  return f.geometry.coordinates.flatMap((p) => p.map(ringToPath)).join(" ");
}

const norm = (s: string) => s.trim().toLowerCase();

export default function WorldHeatMap({
  data,
}: {
  data: { country: string; count: number }[];
}) {
  const [features, setFeatures] = useState<GeoFeature[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(GEOJSON_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((gj: { features: GeoFeature[] }) => {
        if (!cancelled) setFeatures(gj.features);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // count keyed by normalized GeoJSON country name
  const byName = useMemo(() => {
    const m = new Map<string, number>();
    for (const { country, count } of data) {
      const geoName = NAME_ALIASES[country] ?? country;
      const key = norm(geoName);
      m.set(key, (m.get(key) ?? 0) + count);
    }
    return m;
  }, [data]);

  const max = useMemo(() => {
    let x = 0;
    for (const v of byName.values()) if (v > x) x = v;
    return x;
  }, [byName]);

  if (failed) return null;
  if (!features) {
    return (
      <div className="text-muted text-sm py-8 text-center">Loading map…</div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full h-auto block"
      role="img"
      aria-label="World heat map of countries by film count"
    >
      {/* subtle ocean background */}
      <rect width={VIEW_W} height={VIEW_H} fill="var(--color-background)" />
      {features.map((f, i) => {
        const name = f.properties.name;
        const count = byName.get(norm(name)) ?? 0;
        // Log scaling so one dominant country (usually USA) doesn't wash
        // everything else out to near-zero.
        const intensity =
          max > 0 && count > 0
            ? Math.log(count + 1) / Math.log(max + 1)
            : 0;
        const alpha = count === 0 ? 0 : 0.18 + intensity * 0.82;
        const fill =
          count === 0 ? "#2c3440" : `rgba(0, 192, 48, ${alpha.toFixed(3)})`;
        return (
          <path
            key={i}
            d={featurePath(f)}
            fill={fill}
            stroke="#14181c"
            strokeWidth={0.4}
            strokeLinejoin="round"
          >
            <title>{count > 0 ? `${name}: ${count}` : name}</title>
          </path>
        );
      })}
    </svg>
  );
}
