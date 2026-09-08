/**
 * Generates the isometric key candidates (15 onwards).
 *
 *   node agent-outputs/logo-candidates/isometric-key.mjs
 *
 * The key is drawn in plane coordinates - u along the shaft, v across it -
 * and projected with a 30 degree isometric basis, then extruded straight down
 * the screen by its thickness. Side faces are computed, not stacked: an edge
 * of the top face is visible when it runs leftwards on screen (its outward
 * normal points down the screen), and each such edge becomes one
 * parallelogram. The bow's faces are the lower half of its outer ellipse and,
 * inside the hole, the upper half of its inner ellipse, which is the far wall.
 *
 * Every subpath in the side-face path is drawn counter-clockwise on screen,
 * so the nonzero fill rule unions them where they overlap.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

/** A circle of radius R in the plane projects to this ellipse, whatever the orientation. */
const RX = Math.sqrt(1.5);
const RY = Math.sqrt(0.5);

const r2 = (n) => Math.round(n * 100) / 100;

/** The key itself, in plane units. Same proportions as 09. */
const KEY = {
  bow: { center: [0, 0], outer: 9, inner: 4.5 },
  polygons: [
    // shaft
    [[9, -3], [34, -3], [34, 3], [9, 3]],
    // teeth, on the +v side
    [[24, 3], [28, 3], [28, 9], [24, 9]],
    [[30, 3], [34, 3], [34, 9], [30, 9]],
  ],
};

/** Shaft to the lower right, teeth to the lower left: the 09 orientation. */
const DOWN_RIGHT = { u: [COS30, SIN30], v: [-COS30, SIN30] };
/** Shaft to the upper right, teeth to the lower right. */
const UP_RIGHT = { u: [COS30, -SIN30], v: [COS30, SIN30] };

function project(basis, [u, v]) {
  return [u * basis.u[0] + v * basis.v[0], u * basis.u[1] + v * basis.v[1]];
}

/** Signed area, positive for clockwise on a y-down screen. */
function signedArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

const clockwise = (points) => (signedArea(points) >= 0 ? points : [...points].reverse());

const M = (points) => `M${points.map(([x, y]) => `${r2(x)} ${r2(y)}`).join("L")}Z`;

/**
 * The visible side faces of a convex top-face polygon extruded down by t.
 * Each is P, Q, Q + t, P + t for an edge P -> Q that runs leftwards.
 */
function polygonFaces(points, t) {
  const cw = clockwise(points);
  const faces = [];
  for (let i = 0; i < cw.length; i += 1) {
    const [px, py] = cw[i];
    const [qx, qy] = cw[(i + 1) % cw.length];
    if (qx < px) faces.push(M([[px, py], [qx, qy], [qx, qy + t], [px, py + t]]));
  }
  return faces;
}

function ellipse([cx, cy], rx, ry, sweep) {
  return (
    `M${r2(cx + rx)} ${r2(cy)}A${r2(rx)} ${r2(ry)} 0 1 ${sweep} ${r2(cx - rx)} ${r2(cy)}` +
    `A${r2(rx)} ${r2(ry)} 0 1 ${sweep} ${r2(cx + rx)} ${r2(cy)}Z`
  );
}

/** Lower half of an ellipse extruded down by t: the outside of a bow or a disc. */
function outerBand([cx, cy], rx, ry, t) {
  return (
    `M${r2(cx + rx)} ${r2(cy)}A${r2(rx)} ${r2(ry)} 0 0 1 ${r2(cx - rx)} ${r2(cy)}` +
    `v${r2(t)}A${r2(rx)} ${r2(ry)} 0 0 0 ${r2(cx + rx)} ${r2(cy + t)}Z`
  );
}

/** Upper half of an ellipse extruded down by t: the far wall seen inside a hole. */
function innerWall([cx, cy], rx, ry, t) {
  return (
    `M${r2(cx + rx)} ${r2(cy)}A${r2(rx)} ${r2(ry)} 0 0 0 ${r2(cx - rx)} ${r2(cy)}` +
    `v${r2(t)}A${r2(rx)} ${r2(ry)} 0 0 1 ${r2(cx + rx)} ${r2(cy + t)}Z`
  );
}

/**
 * A flat shape with a top face and side faces. `shape` is either a disc
 * ({ center, radius }) or a list of convex polygons plus an optional bow, all
 * in plane units. Returns the two path strings and every screen point, for
 * fitting the drawing to the canvas.
 */
function slab(shape, basis, t, lift) {
  const top = [];
  const sides = [];
  const points = [];
  const at = ([x, y]) => [x, y - lift];

  const addEllipse = (center, radius, hole) => {
    const c = at(project(basis, center));
    const rx = radius * RX;
    const ry = radius * RY;
    top.push(ellipse(c, rx, ry, hole ? 0 : 1));
    sides.push(hole ? innerWall(c, rx, ry, t) : outerBand(c, rx, ry, t));
    points.push([c[0] - rx, c[1] - ry], [c[0] + rx, c[1] + ry + t]);
  };

  if (shape.radius !== undefined) {
    addEllipse(shape.center, shape.radius, false);
  }
  if (shape.bow) {
    addEllipse(shape.bow.center, shape.bow.outer, false);
    addEllipse(shape.bow.center, shape.bow.inner, true);
  }
  for (const polygon of shape.polygons ?? []) {
    const screen = clockwise(polygon.map((p) => at(project(basis, p))));
    top.push(M(screen));
    sides.push(...polygonFaces(screen, t));
    for (const [x, y] of screen) points.push([x, y], [x, y + t]);
  }

  return { top: top.join(""), sides: sides.join(""), points };
}

/** Fits every point into the 64 grid with a 4 unit margin, without enlarging. */
function fit(points) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(1, 56 / Math.max(maxX - minX, maxY - minY));
  const tx = 32 - scale * (minX + maxX) / 2;
  const ty = 32 - scale * (minY + maxY) / 2;
  return `translate(${r2(tx)} ${r2(ty)}) scale(${r2(scale)})`;
}

function svg(concept, body) {
  return (
    `<!-- Concept: ${concept} -->\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">\n` +
    `${body}\n</svg>\n`
  );
}

/**
 * One candidate. `base`, when given, is a disc or plate the key rests on:
 * its top face is the ground, and the key's faces run from its own top down
 * to that ground.
 */
function candidate({ concept, basis = DOWN_RIGHT, thickness = 4, key, base, outline }) {
  const parts = [];
  const points = [];

  if (base) {
    const ground = slab(base.shape, basis, base.thickness, 0);
    points.push(...ground.points);
    parts.push(`  <path fill="${base.side}" d="${ground.sides}"/>`);
    parts.push(`  <path fill="${base.top}" d="${ground.top}"/>`);
  }

  const body = slab(KEY, basis, thickness, base ? thickness : 0);
  points.push(...body.points);

  if (outline) {
    // Two outlines, the top face and the same face at the foot of the slab,
    // rather than a solid: the wireframe reading of the same object.
    parts.push(
      `  <g fill="none" stroke-width="${outline.width}" stroke-linejoin="round">`,
      `    <path stroke="${outline.back}" transform="translate(0 ${r2(thickness)})" d="${body.top}"/>`,
      `    <path stroke="${outline.front}" d="${body.top}"/>`,
      `  </g>`,
    );
  } else {
    parts.push(`  <path fill="${key.side}" d="${body.sides}"/>`);
    parts.push(`  <path fill="${key.top}" d="${body.top}"/>`);
  }

  return svg(concept, `<g transform="${fit(points)}">\n${parts.join("\n")}\n</g>`);
}

const PLATE = {
  polygons: [[[-15, -16], [42, -16], [42, 16], [-15, 16]]],
};

const CANDIDATES = [
  [
    "15-brass-key.svg",
    {
      concept: "the isometric key in brass: amber top, darker amber sides",
      key: { top: "#fbbf24", side: "#b45309" },
    },
  ],
  [
    "16-indigo-key-on-disc.svg",
    {
      concept: "an indigo isometric key resting on a slate disc, the disc showing through the bow",
      key: { top: "#6366f1", side: "#3730a3" },
      base: {
        shape: { center: [12.5, 0], radius: 23 },
        thickness: 3,
        top: "#e2e8f0",
        side: "#94a3b8",
      },
    },
  ],
  [
    "17-emerald-thick-key.svg",
    {
      concept: "the isometric key cut thick, seven units, in emerald",
      thickness: 7,
      key: { top: "#34d399", side: "#065f46" },
    },
  ],
  [
    "18-cyan-key-on-dark-plate.svg",
    {
      concept: "a cyan isometric key on a near-black plate, for dark surfaces and app icons",
      key: { top: "#22d3ee", side: "#155e75" },
      base: {
        shape: PLATE,
        thickness: 3,
        top: "#262626",
        side: "#0a0a0a",
      },
    },
  ],
  [
    "19-blue-key-up-right.svg",
    {
      concept: "the isometric key turned to point up and right, teeth towards the viewer, in blue",
      basis: UP_RIGHT,
      key: { top: "#3b82f6", side: "#1e3a8a" },
    },
  ],
  [
    "20-violet-outline-key.svg",
    {
      concept: "the isometric key as two outlines, the top face and its foot, in violet",
      thickness: 5,
      key: {},
      outline: { front: "#7c3aed", back: "#c4b5fd", width: 2.4 },
    },
  ],
];

for (const [name, options] of CANDIDATES) {
  writeFileSync(join(here, name), candidate(options));
  console.log(`wrote ${name}`);
}
