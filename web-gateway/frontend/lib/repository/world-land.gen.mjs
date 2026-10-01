// Regenerates lib/repository/world-land.ts. Run by hand, never at build time:
//
//   npm i --prefix /tmp/geo world-atlas@2.0.2 topojson-client
//   node lib/repository/world-land.gen.mjs /tmp/geo > lib/repository/world-land.ts
//
// The argument is the folder `npm i --prefix` installed into. Natural Earth
// 1:110m land is already cut at +-180, so a plain equirectangular projection
// (x = lon + 180, y = 90 - lat, one unit per degree) is enough.
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const require = createRequire(path.join(root, "noop.js"));
const topology = require(path.join(root, "node_modules/world-atlas/land-110m.json"));
const { feature } = require(path.join(root, "node_modules/topojson-client"));

const land = feature(topology, topology.objects.land);
const geometries = land.type === "FeatureCollection" ? land.features.map((f) => f.geometry) : [land.geometry];
// Simplification: Douglas-Peucker at EPSILON units (degrees), rings smaller than MIN_EXTENT dropped.
const EPSILON = 0.6;
const MIN_EXTENT = 1;

function simplify(pts) {
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1;
    let at = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay);
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const dist = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (dist > worst) {
        worst = dist;
        at = i;
      }
    }
    if (worst > EPSILON) {
      keep[at] = true;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// Coordinates are whole tenths of a unit; the path is written in relative commands.
const tenths = (n) => Math.round(n * 10);
const fmt = (n) => String(n / 10).replace(/^(-?)0\./, "$1.");

let d = "";
for (const g of geometries) {
  const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const polygon of polygons) {
    // Natural Earth 110m land has no holes worth drawing at thumbnail size except the Caspian; keep every ring.
    for (const ring of polygon) {
      let pts = [];
      for (const [lon, lat] of ring) {
        const p = [tenths(lon + 180), tenths(90 - lat)];
        const last = pts[pts.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
      }
      if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      if (Math.max(...xs) - Math.min(...xs) < MIN_EXTENT * 10 && Math.max(...ys) - Math.min(...ys) < MIN_EXTENT * 10) continue;
      pts = simplify([...pts, pts[0]]).slice(0, -1);
      if (pts.length < 3) continue;
      let out = `M${fmt(pts[0][0])} ${fmt(pts[0][1])}l`;
      // Smallest valid separators: none before a minus sign, none before a number that starts with a dot and follows one that has a dot.
      let body = "";
      for (let i = 1; i < pts.length; i++) {
        for (const n of [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]) {
          const t = fmt(n);
          if (body && !t.startsWith("-") && !(t.startsWith(".") && /\.\d*$/.test(body))) body += " ";
          body += t;
        }
      }
      d += out + body + "z";
    }
  }
}

process.stdout.write(`// GENERATED FILE. Do not edit; regenerate with lib/repository/world-land.gen.mjs.
//
// World land as one SVG path, for the coverage thumbnail: an equirectangular
// projection on a 360 x 180 grid (x = longitude + 180, y = 90 - latitude).
// Source: Natural Earth 1:110m land (public domain) via world-atlas 2.0.2.

export const WORLD_LAND_PATH =
  ${JSON.stringify(d)};
`);
