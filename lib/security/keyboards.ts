/**
 * Keyboard adjacency: for every key, the keys around it in a fixed order of
 * directions, for finding patterns like qwerty, zxcvbn and 7894561.
 *
 * Built from drawings of the layouts the way zxcvbn builds its graphs: on a
 * typewriter layout each row is set half a key to the right of the one
 * above, so a key has six neighbours (left, up-left, up-right, right,
 * down-right, down-left); on a keypad the keys are aligned and have eight.
 * A neighbour is the characters on that key, unshifted then shifted, or
 * null past the edge.
 */

export type AdjacencyGraph = Record<string, (string | null)[]>;

const QWERTY = String.raw`
${"`"}~ 1! 2@ 3# 4$ 5% 6^ 7& 8* 9( 0) -_ =+
    qQ wW eE rR tT yY uU iI oO pP [{ ]} \|
     aA sS dD fF gG hH jJ kK lL ;: '"
      zZ xX cC vV bB nN mM ,< .> /?
`;

const DVORAK = String.raw`
${"`"}~ 1! 2@ 3# 4$ 5% 6^ 7& 8* 9( 0) [{ ]}
    '" ,< .> pP yY fF gG cC rR lL /? =+ \|
     aA oO eE uU iI dD hH tT nN sS -_
      ;: qQ jJ kK xX bB mM wW vV zZ
`;

const KEYPAD = `
  / * -
7 8 9 +
4 5 6
1 2 3
  0 .
`;

const MAC_KEYPAD = `
  = / *
7 8 9 -
4 5 6 +
1 2 3
  0 .
`;

const slanted = (x: number, y: number): [number, number][] => [
  [x - 1, y],
  [x, y - 1],
  [x + 1, y - 1],
  [x + 1, y],
  [x, y + 1],
  [x - 1, y + 1],
];

const aligned = (x: number, y: number): [number, number][] => [
  [x - 1, y],
  [x - 1, y - 1],
  [x, y - 1],
  [x + 1, y - 1],
  [x + 1, y],
  [x + 1, y + 1],
  [x, y + 1],
  [x - 1, y + 1],
];

export function buildGraph(layout: string, isSlanted: boolean): AdjacencyGraph {
  const positions = new Map<string, string>();
  const tokens = layout.split(/\s+/).filter(Boolean);
  const unit = tokens[0].length + 1;
  const order: [number, number, string][] = [];
  layout.split("\n").forEach((line, y) => {
    const slant = isSlanted ? y - 1 : 0;
    let from = 0;
    for (const token of line.split(/\s+/).filter(Boolean)) {
      const at = line.indexOf(token, from);
      from = at + token.length;
      const x = Math.floor((at - slant) / unit);
      positions.set(`${x},${y}`, token);
      order.push([x, y, token]);
    }
  });
  const graph: AdjacencyGraph = {};
  for (const [x, y, token] of order) {
    for (const character of token) graph[character] = (isSlanted ? slanted : aligned)(x, y).map(([nx, ny]) => positions.get(`${nx},${ny}`) ?? null);
  }
  return graph;
}

export const GRAPHS: { name: "qwerty" | "dvorak" | "keypad" | "mac_keypad"; graph: AdjacencyGraph }[] = [
  { name: "qwerty", graph: buildGraph(QWERTY, true) },
  { name: "dvorak", graph: buildGraph(DVORAK, true) },
  { name: "keypad", graph: buildGraph(KEYPAD, false) },
  { name: "mac_keypad", graph: buildGraph(MAC_KEYPAD, false) },
];
