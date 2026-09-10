# Logo candidates for key.is

Twenty minimal SVG marks for the "key.is" / "Key" brand: eight flat ones
(01-08), six with depth (09-14) built from layers and extrusion, and six
isometric variations in colour (15-20). Every file is a standalone SVG with an
explicit viewBox, no external references, no scripts and no raster images,
drawn on a 64 px grid (240 x 64 for the wordmark) so each one can be scaled to
a 16 px favicon or a 256 px app icon without redrawing.

Colours come from `app/globals.css` and nothing else. The flat marks are
foreground `#0a0a0a` on a transparent background, plus `#ffffff` for the
knocked-out K in 08. The depth marks add muted `#737373` for side faces,
subtle `#a3a3a3` and border-strong `#d4d4d4` for the layers behind, and
`#ffffff` for a keyhole cut into a dark face; nothing is shaded with a
gradient, so each mark is at most four flat tones. The isometric variations
are the one set that leaves the neutral palette: each uses one hue in two
tones (a lighter top face, a darker side face), taken from the Tailwind
scale the site's neutral tokens already come from, so whichever is chosen can
become the accent colour without the rest of the palette moving.

## Candidates

- `01-geometric-key.svg` - A solid key: ring bow, flat shaft, two square teeth,
  drawn as one filled path. The most literal mark. Works best as the app icon
  and social card mark at 64 px and up; readable but a little fine at 16 px.

- `02-keyhole.svg` - A keyhole cut out of a rounded square tile (evenodd path),
  so the hole shows whatever is behind it. The strongest favicon candidate:
  it is a solid block at 16 px and still reads as a keyhole. Also suits the
  social card avatar. Invert the fill for dark surfaces.

- `03-k-monogram.svg` - A stroked K whose spine is an upright key shaft: the
  ring bow sits at the foot of the stem and two teeth project from its top on
  the side away from the arms. Ties the letter and the object together. (A
  bow-on-top version was tried first and read as a stick figure at 16 px.)
  Best in the header next to or instead of the wordmark at 24 to 32 px, and as
  an app icon.

- `04-wordmark.svg` - "key.is" set in Inter semibold at 48 px with tightened
  letter-spacing, matching the header's current text wordmark. The dot is
  replaced by a small ring, the key bow from the other marks, so the wordmark
  and the icon share one motif. Best for the site header and the social card
  headline; not for the favicon. Renders with Inter when it is installed or
  loaded, otherwise with the system sans.

- `05-line-key.svg` - A stroke-only key at 45 degrees with round caps and a
  3 px stroke on the 64 px grid, in the same visual language as the lucide
  tool icons the site already uses. Best inline with text at 18 to 32 px (nav,
  buttons, footer); too thin for a 16 px favicon.

- `06-open-lock.svg` - An open padlock: solid body, stroked shackle lifted
  clear on one side. Says "unlocked, no limits" rather than "key", so it suits
  a promotional social card or an empty-state illustration more than the
  favicon. Reads well at every size.

- `07-bow-and-bracket.svg` - The abstract one: a key reduced to a ring, a bar
  and a square bracket, all 6 px strokes with square joins. Reads as a glyph
  rather than a picture, and is the best fit if the brand should feel like a
  tool rather than a padlock. Works at 16 px and up; good app icon and favicon.

- `08-k-tile.svg` - A white K on a dark rounded tile, the only two-colour
  file. The pragmatic option for slots that demand a square avatar: favicon,
  touch icon, GitHub or social profile. Pairs with the wordmark in 04; carries
  no key reference on its own.

## Candidates with depth

Still minimal: the third dimension comes from a few flat shapes, never from
gradients or shadows. Side faces are drawn as their own polygons where an
edge is diagonal (09, 11), since stacking shifted copies leaves stair-steps
there; the straight-down extrusion in 14 is stacked copies at half-unit steps,
which is smooth at every size.

- `09-isometric-key.svg` - The geometric key laid flat in isometric
  projection and extruded four units down: the bow becomes an ellipse, the
  shaft runs to the lower right, and the far wall of the bow shows inside the
  hole. The most "object"-like mark. Best at 32 px and up; at 16 px the
  teeth blur, so pair it with 12 or 14 for the favicon.

- `10-layered-key.svg` - The flat key from 01 three times, each layer offset
  up and to the right and a step lighter behind. Reads as depth and as
  "layers of tools" at once, and survives 16 px because the front layer is
  the full flat mark. Good for the index and social cards.

- `11-extruded-k.svg` - A heavy geometric K extruded diagonally, six units
  down and right, in one mid grey. The K stands on its own without a key
  reference, so it pairs with the wordmark rather than replacing it. Strong at
  every size, including 16 px.

- `12-keyhole-cube.svg` - An isometric cube in three tones, light top, mid
  left, dark right, with a keyhole cut into the dark face in the face's own
  skew. The tidiest favicon of the depth set: a solid block at 16 px that is
  still recognisably a keyhole. Works on light surfaces only, since the top
  face is the lightest grey.

- `13-stacked-tiles.svg` - Three rounded tiles fanned along the diagonal like
  a stack of files, lightest at the back, with the keyhole on the front one.
  Says "many tools, one key". Reads at every size; at 16 px it is a keyhole
  tile with a hint of a stack behind it.

- `14-extruded-keyhole-tile.svg` - The keyhole tile from 02 given a six-unit
  edge below it, so it sits on the page like a button and the far wall of
  the keyhole shows inside the cut. The closest to an app icon; reads at
  16 px exactly as 02 does.

## Isometric variations, in colour

Six takes on 09, the isometric key, generated by `isometric-key.mjs` in this
directory (`node agent-outputs/logo-candidates/isometric-key.mjs` rewrites
them). The key is drawn in plane units and projected with a 30 degree
isometric basis; the side faces are computed from which edges of the top face
run leftwards on screen, so any orientation, thickness or base comes out with
exact geometry rather than stacked copies. Change a colour, a thickness or the
basis in the `CANDIDATES` table and run it again.

- `15-brass-key.svg` - The 09 key in brass: amber top (`#fbbf24`), darker
  amber sides (`#b45309`). The literal reading of "key". Warm against the
  neutral site; reads at every size down to 16 px, where it becomes a small
  golden key.

- `16-indigo-key-on-disc.svg` - An indigo key (`#6366f1` / `#3730a3`)
  resting on a slate disc (`#e2e8f0` / `#94a3b8`), with the disc showing
  through the bow. The disc gives the mark a footprint, which suits a
  social-card illustration or an empty state more than a favicon, where the
  key gets small.

- `17-emerald-thick-key.svg` - The key cut seven units thick in emerald
  (`#34d399` / `#065f46`). The chunkiest of the set; the extra depth is what
  makes it read as an object at 32 px, and the darker side face carries it
  at 16 px.

- `18-cyan-key-on-dark-plate.svg` - A cyan key (`#22d3ee` / `#155e75`) on a
  near-black isometric plate (`#262626` / `#0a0a0a`). The one built for dark
  surfaces and app-icon slots: the plate is the icon's own background, so it
  works on any colour behind it. The strongest 16 px of the six.

- `19-blue-key-up-right.svg` - The same key turned to point up and to the
  right, teeth towards the viewer, in blue (`#3b82f6` / `#1e3a8a`). The
  orientation gives it motion, and the teeth show their side faces, which the
  down-right version hides. Reads at every size.

- `20-violet-outline-key.svg` - The isometric key as two outlines rather
  than a solid: the top face in violet (`#7c3aed`) over the same face at the
  foot of the slab in a pale tint (`#c4b5fd`). The wireframe reading of the
  object; best at 32 px and up, since the back outline turns to noise at
  16 px.

## Suggested pairings

- Favicon plus header: 02 or 08 as the favicon, 04 as the header wordmark.
- One mark everywhere: 03 (letter and key in one) or 07 (abstract key).
- Social card: 04 wordmark large, with 06 or 01 as the illustration.
- With depth: 14 as the favicon and app icon, 10 or 13 as the larger mark on
  the index and social cards, 11 beside the wordmark in the header.
- In colour: 18 as the favicon and app icon, 15 or 17 as the larger mark,
  with the chosen hue becoming the site's one accent colour.

## Preview

Open any of the SVG files directly in a browser (drag it onto a tab or use
`file:///.../agent-outputs/logo-candidates/01-geometric-key.svg`) and zoom in
and out; the browser's zoom is a reasonable stand-in for the 16 px to 256 px
range. All files are plain ASCII, so they pass `npm run check:characters`.
