export type IdenticonKind = "account" | "contract" | "asset" | "transaction" | "system";

const PALETTES: Array<[string, string, string]> = [
  ["#7dd3fc", "#2563eb", "#0f172a"],
  ["#a3ff5f", "#2fa84f", "#102315"],
  ["#fbbf24", "#e8823c", "#2b1b10"],
  ["#f472b6", "#be185d", "#27101b"],
  ["#c4b5fd", "#6e56cf", "#181225"],
  ["#67e8f9", "#0891b2", "#0d2328"],
  ["#fca5a5", "#e5484d", "#2b1111"],
  ["#d9f99d", "#65a30d", "#17230a"],
];

function fnv1a(input: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function identiconBytes(value: string, kind: IdenticonKind = "account") {
  const input = `${kind}:${value.trim()}`;
  const seeds = [2166136261, 709607, 1402946737, 19349663, 83492791, 2654435761, 374761393, 668265263];
  return seeds.flatMap((seed) => {
    const hash = fnv1a(input, seed);
    return [hash & 255, (hash >>> 8) & 255, (hash >>> 16) & 255, (hash >>> 24) & 255];
  });
}

export function identiconPalette(bytes: number[]) {
  return PALETTES[bytes[0] % PALETTES.length];
}

export function identiconCells(bytes: number[], kind: IdenticonKind = "account") {
  const size = 7;
  const cells: Array<{ x: number; y: number; tone: 0 | 1 }> = [];
  const symmetric = kind !== "transaction";
  let cursor = 1;

  for (let y = 0; y < size; y += 1) {
    const width = symmetric ? 4 : size;
    for (let x = 0; x < width; x += 1) {
      const byte = bytes[cursor % bytes.length];
      const density = kind === "contract" ? 2 : kind === "asset" ? 3 : 4;
      const filled = byte % 6 < density;
      cursor += 1;
      if (!filled) continue;
      const tone = byte % 5 === 0 ? 1 : 0;
      cells.push({ x, y, tone });
      if (symmetric && x !== size - 1 - x) cells.push({ x: size - 1 - x, y, tone });
    }
  }

  if (kind === "contract") {
    for (let index = 0; index < size; index += 1) {
      cells.push({ x: index, y: 0, tone: 1 }, { x: index, y: size - 1, tone: 1 });
      cells.push({ x: 0, y: index, tone: 1 }, { x: size - 1, y: index, tone: 1 });
    }
  }

  if (kind === "asset") {
    cells.push({ x: 3, y: 2, tone: 1 }, { x: 2, y: 3, tone: 1 }, { x: 3, y: 3, tone: 1 }, { x: 4, y: 3, tone: 1 }, { x: 3, y: 4, tone: 1 });
  }

  return cells;
}
