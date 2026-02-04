/**
 * Geometric placement - shapes touch edge-to-edge with no gaps and no overlaps.
 * Contact point is passed between shapes so path edges meet exactly.
 */
import { rotatePoint } from './shapeUtils.js';

/**
 * Find leftmost and rightmost points of rotated shape
 */
function getExtents(vertices, angle) {
  let leftmost = { x: Infinity, y: 0 };
  let rightmost = { x: -Infinity, y: 0 };

  for (const v of vertices) {
    const r = rotatePoint(v, angle);
    if (r.x < leftmost.x) leftmost = { ...r };
    if (r.x > rightmost.x) rightmost = { ...r };
  }

  return { leftmost, rightmost };
}

/**
 * Place shapes so they touch at path edges - no gaps, no overlaps.
 */
export function placeShapes(shapeDataList, order, rotations) {
  const placed = [];
  let contactX = 0;
  let contactY = 0;

  for (let i = 0; i < order.length; i++) {
    const idx = order[i];
    const { vertices } = shapeDataList[idx];
    const angle = rotations[i];

    const { leftmost, rightmost } = getExtents(vertices, angle);

    // Position so leftmost point touches the contact point exactly
    const posX = contactX - leftmost.x;
    const posY = contactY - leftmost.y;

    placed.push({
      vertices,
      position: { x: posX, y: posY },
      rotation: angle,
    });

    contactX = posX + rightmost.x;
    contactY = posY + rightmost.y;
  }

  return { placed, bounds: { right: contactX } };
}
