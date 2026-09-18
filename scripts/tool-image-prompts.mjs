/*
 * What each tool's featured image is a drawing of.
 *
 * Split out from scripts/generate-tool-images.mjs so the prompts can be read
 * without pulling in an image library: tests/toolImages.test.ts imports this
 * to check the drawn set against the registry, and has no business loading
 * sharp to do it.
 */

/*
 * The half of every prompt that never changes.
 *
 * Every clause here was added because something came back wrong without it.
 * The palette is the mark's own three tones (see public/logo.svg): the light
 * blue is what faces up, the mid blue faces left, the deep blue faces right,
 * which is also how the isometric plates in the logo are lit. Naming the
 * hexadecimal values is what keeps seventeen drawings the same blue.
 */
export const STYLE = [
  "Rendered as a clean 3D isometric illustration: true isometric projection,",
  "viewed from above and slightly to the left, flat matte surfaces with crisp",
  "edges and soft ambient shading only.",
  "Strict color palette, nothing outside it: light sky blue #5EC2FF on every",
  "upward-facing top surface, medium blue #2F8EE0 on every left-facing side,",
  "deep blue #1C5FB8 on every right-facing side, plus white and pale grey",
  "#E8EEF5 for small highlights and details.",
  "Absolutely no background: fully transparent, no backdrop, no ground plane,",
  "no floor, no shadow, no glow, no halo, no haze, no light rays, no",
  "reflections, no gradient wash behind the object.",
  "Wide landscape composition: the scene is spread out horizontally and fills",
  "the full width of the frame, balanced left to right, with a small even",
  "margin on all four sides. No text, no letters, no numbers, no logos,",
  "no people.",
].join(" ");

/*
 * The half that does change: what one tool's drawing is of.
 *
 * One line per tool, written as a scene rather than a noun, because a scene is
 * what tells a visitor which of sixty-three tools they are looking at. "A
 * picture file" draws the same block for eight image tools; "a picture squeezed
 * flat by a press" draws only the compressor.
 *
 * The keys of this object are the source of truth for which tools have an
 * image. tests/toolImages.test.ts asserts they match the tools
 * flagged `image: true` in lib/tools.ts, in both directions, and that each one
 * has a file on disk - so a tool cannot end up flagged with nothing to draw,
 * or drawn and never shown.
 *
 * The pilot covers three whole categories - Subtitles, Images and Files - so
 * the index shows complete illustrated groups next to plain ones, rather than
 * a ragged row of some cards with pictures and some without.
 */
export const PROMPTS = {
  // ---- Subtitles --------------------------------------------------------
  "convert-subtitles":
    "A subtitle document card on the left travelling along a short track into a faceted cube-shaped conversion machine in the middle, and coming out on the right as a differently shaped subtitle document card with rounded corners",
  "extract-subtitles":
    "A solid isometric video file block on the left with a long ribbon of small caption cards being pulled out of a slot in its side and unrolling across to the right",
  "burn-subtitles":
    "A tall isometric video screen panel standing upright showing a simple mountain scene, with a caption bar fused across its lower third, and a heavy branding iron on the right pressing that caption bar into the face of the panel",
  "merge-subtitles":
    "Two separate ribbons of small caption cards coming in from the upper left and lower left, weaving together in the middle, and leaving to the right as one ribbon whose cards each carry two stacked caption bars",
  "add-subtitles":
    "A ribbon of small caption cards on the left sliding along an arrow into an open slot on the side of a solid isometric video file block on the right",

  // ---- Images -----------------------------------------------------------
  "convert-image":
    "A framed picture tile on the left travelling along a short track into a faceted cube-shaped conversion machine in the middle, and coming out on the right as a picture tile of a different shape",
  "compress-image":
    "A thick framed picture tile on the left, and on the right the same picture tile squeezed between the two heavy plates of a press into a thin flat slab, with the upper plate pushing down and the lower plate holding it",
  "resize-image":
    "A large framed picture tile on the left with small square corner handles, a dashed guide outline stepping down diagonally, and the same picture tile redrawn much smaller on the right",
  "remove-image-metadata":
    "A framed picture tile lying flat, with several small rounded label chips lifting up off its surface and drifting away to the right, each one fading into separate small fragments",
  "crop-image":
    "A large framed picture panel lying flat, with a bright L-shaped bracket at its top left corner and another at its bottom right corner marking out a smaller rectangle inside it, and the excess outer border of the panel sliced off and sliding away to the right",
  "watermark-image":
    "A framed picture panel lying flat, with a thin translucent pale plate carrying a small diagonal bar shape descending onto its surface from the upper right",
  "favicon":
    "A large framed picture tile on the left carrying a simple mountain and sun motif on its face, fanning out to the right into a descending row of four progressively smaller copies of the same tile, the smallest one seated in the corner of a plain rounded browser tab shape",
  "image-to-base64":
    "A framed picture tile on the left unravelling from its right edge into a long horizontal ribbon of small blank square blocks that stream away to the right",

  // ---- Files ------------------------------------------------------------
  checksum:
    "A single file card standing upright on a low isometric pedestal on the left, and to the right a horizontal bar made of many narrow blocks of differing heights, like a fingerprint readout",
  "create-zip":
    "Several loose file cards on the left being drawn along arrows into an open archive box on the right whose lid carries a zipper running along its edge",
  "extract-zip":
    "An open archive box with an unzipped lid on the left, with file cards lifting out of it and fanning up and away to the right",
  "find-duplicates":
    "A neat isometric grid of nine file cards lying flat, with two matching pairs lifted up above the grid and joined by a short link, while the rest stay down",
};
