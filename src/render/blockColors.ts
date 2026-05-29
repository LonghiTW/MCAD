export const blockColors: Record<string, [number, number, number, number]> = {
  grass_block: [0.27, 0.55, 0.22, 1],
  gray_concrete: [0.45, 0.47, 0.5, 1],
  blue_concrete: [0.11, 0.38, 0.82, 1],
  stone_bricks: [0.57, 0.56, 0.54, 1],
  white_concrete: [0.84, 0.84, 0.8, 1],
  oak_planks: [0.67, 0.48, 0.28, 1]
};

export function colorForBlock(blockType: string): [number, number, number, number] {
  return blockColors[blockType.replace("minecraft:", "")] ?? [0.82, 0.82, 0.78, 1];
}
