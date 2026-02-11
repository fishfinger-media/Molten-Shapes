/**
 * Layout: given rotation and scale per shape, compute positions so shapes
 * sit in a straight line with no gap (right edge of shape i touches left edge of shape i+1).
 * All shapes share a common baseline (center-y aligned).
 */

/**
 * Transform a point (x, y) by: translate(-cx,-cy) -> scale(s) -> rotate(θ degrees).
 * Returns { x, y } in the transformed space (center at origin, then scaled and rotated).
 */
function transformPoint(x, y, cx, cy, angleDeg, scale) {
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = (x - cx) * scale
  const dy = (y - cy) * scale
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  }
}

/**
 * Get axis-aligned bounding box of a shape when drawn with rotate(θ) scale(s)
 * around its viewBox center. Returns { minX, maxX, minY, maxY, width, height, cx, cy }.
 */
export function getShapeAABB(shape, rotation, scale) {
  const { viewBox } = shape
  const vw = viewBox.width
  const vh = viewBox.height
  const cx = vw / 2
  const cy = vh / 2

  const corners = [
    [0, 0],
    [vw, 0],
    [vw, vh],
    [0, vh],
  ]

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const [x, y] of corners) {
    const t = transformPoint(x, y, cx, cy, rotation, scale)
    minX = Math.min(minX, t.x)
    maxX = Math.max(maxX, t.x)
    minY = Math.min(minY, t.y)
    maxY = Math.max(maxY, t.y)
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    cx,
    cy,
  }
}

/**
 * Compute positions for all shapes so they are in a horizontal line with no gap.
 * stateById: { [shapeId]: { rotation, scale } }
 * Returns { positions: [ { tx, ty, ...aabb } ], totalWidth, totalHeight, globalMinY }.
 */
export function computeLayout(shapes, stateById) {
  const aabbs = shapes.map((shape) => {
    const s = stateById[shape.id] || { rotation: 0, scale: 1 }
    return {
      shape,
      ...getShapeAABB(shape, s.rotation, s.scale),
    }
  })

  const globalMinY = Math.min(...aabbs.map((a) => a.minY))
  const globalMaxY = Math.max(...aabbs.map((a) => a.maxY))
  const totalHeight = globalMaxY - globalMinY

  // Place shapes so right edge of shape i = left edge of shape i+1 (no gap).
  let rightEdge = 0

  const positions = aabbs.map((aabb) => {
    const tx = rightEdge - aabb.minX // so this shape's left edge = rightEdge
    const ty = -globalMinY // common baseline so top of composition is 0
    rightEdge = tx + aabb.maxX // next shape's left edge = this shape's right edge
    return {
      tx,
      ty,
      ...aabb,
    }
  })

  const totalWidth = rightEdge

  return {
    positions,
    totalWidth,
    totalHeight,
    globalMinY,
  }
}
