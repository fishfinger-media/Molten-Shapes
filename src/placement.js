/**
 * Geometric placement - shapes touch edge-to-edge with no gaps
 */
import { rotatePoint } from './shapeUtils.js';

/**
 * Find leftmost and rightmost points of rotated shape (vertices in local coords)
 */
function getExtents(vertices, angle) {
  let leftmost = { x: Infinity, y: 0 };
  let rightmost = { x: -Infinity, y: 0 };

  for (const v of vertices) {
    const r = rotatePoint(v, angle);
    if (r.x < leftmost.x) leftmost = r;
    if (r.x > rightmost.x) rightmost = r;
  }

  return { leftmost, rightmost };
}

/**
 * Place shapes in a row so they touch edge-to-edge.
 * Contact point is passed between shapes so there are no gaps.
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

    // Position so leftmost point touches the contact point (no gaps)
    const posX = contactX - leftmost.x;
    const posY = contactY - leftmost.y;

    placed.push({
      vertices,
      position: { x: posX, y: posY },
      rotation: angle,
    });

    // Next contact is at this shape's rightmost point
    contactX = posX + rightmost.x;
    contactY = posY + rightmost.y;
  }

  return { placed, bounds: { right: contactX } };
}
