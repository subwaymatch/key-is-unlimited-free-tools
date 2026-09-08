# Logo candidates for key.is

Eight minimal SVG marks for the "key.is" / "Key" brand. Every file is a
standalone SVG with an explicit viewBox, no external references, no scripts and
no raster images, drawn on a 64 px grid (240 x 64 for the wordmark) so each one
can be scaled to a 16 px favicon or a 256 px app icon without redrawing.

Colours come from `app/globals.css` and nothing else: foreground `#0a0a0a` on a
transparent background for all marks, plus `#ffffff` for the knocked-out K in
08. Muted `#737373`, subtle `#a3a3a3` and border `#e5e5e5` are reserved for a
secondary treatment (for example, recolouring the ".is" of the wordmark) and
are not used in the files as shipped.

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

## Suggested pairings

- Favicon plus header: 02 or 08 as the favicon, 04 as the header wordmark.
- One mark everywhere: 03 (letter and key in one) or 07 (abstract key).
- Social card: 04 wordmark large, with 06 or 01 as the illustration.

## Preview

Open any of the SVG files directly in a browser (drag it onto a tab or use
`file:///.../agent-outputs/logo-candidates/01-geometric-key.svg`) and zoom in
and out; the browser's zoom is a reasonable stand-in for the 16 px to 256 px
range. All files are plain ASCII, so they pass `npm run check:characters`.
