/**
 * Geometric placement - shapes touch edge-to-edge with no gaps and no overlaps.
 * Shapes rotate around their center points, which are aligned horizontally.
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
 * Find the maximum X coordinate a shape reaches at a given Y level
 * This checks edges between vertices, not just vertices themselves
 */
function getMaxXAtY(vertices, angle, targetY) {
  const EPSILON = 1e-10;
  let maxX = -Infinity;
  
  // Check all vertices
  for (const v of vertices) {
    const r = rotatePoint(v, angle);
    if (Math.abs(r.y - targetY) < EPSILON && r.x > maxX) {
      maxX = r.x;
    }
  }
  
  // Check edges between consecutive vertices
  for (let i = 0; i < vertices.length; i++) {
    const v1 = rotatePoint(vertices[i], angle);
    const v2 = rotatePoint(vertices[(i + 1) % vertices.length], angle);
    
    // Check if edge crosses targetY (with epsilon tolerance)
    const minY = Math.min(v1.y, v2.y);
    const maxY = Math.max(v1.y, v2.y);
    
    if (targetY >= minY - EPSILON && targetY <= maxY + EPSILON && Math.abs(maxY - minY) > EPSILON) {
      // Linear interpolation to find X at targetY
      const t = (targetY - v1.y) / (v2.y - v1.y);
      const x = v1.x + t * (v2.x - v1.x);
      if (x > maxX) {
        maxX = x;
      }
    }
  }
  
  return maxX === -Infinity ? getExtents(vertices, angle).rightmost.x : maxX;
}

/**
 * Find the minimum X coordinate a shape reaches at a given Y level
 */
function getMinXAtY(vertices, angle, targetY) {
  const EPSILON = 1e-10;
  let minX = Infinity;
  
  // Check all vertices
  for (const v of vertices) {
    const r = rotatePoint(v, angle);
    if (Math.abs(r.y - targetY) < EPSILON && r.x < minX) {
      minX = r.x;
    }
  }
  
  // Check edges between consecutive vertices
  for (let i = 0; i < vertices.length; i++) {
    const v1 = rotatePoint(vertices[i], angle);
    const v2 = rotatePoint(vertices[(i + 1) % vertices.length], angle);
    
    // Check if edge crosses targetY (with epsilon tolerance)
    const minY = Math.min(v1.y, v2.y);
    const maxY = Math.max(v1.y, v2.y);
    
    if (targetY >= minY - EPSILON && targetY <= maxY + EPSILON && Math.abs(maxY - minY) > EPSILON) {
      // Linear interpolation to find X at targetY
      const t = (targetY - v1.y) / (v2.y - v1.y);
      const x = v1.x + t * (v2.x - v1.x);
      if (x < minX) {
        minX = x;
      }
    }
  }
  
  return minX === Infinity ? getExtents(vertices, angle).leftmost.x : minX;
}

/**
 * Get the maximum X coordinate a shape reaches at any given Y coordinate
 * This creates a function that maps Y -> max X for overlap detection
 */
function getMaxXAtAnyY(prevVertices, prevAngle, prevPosition) {
  // Sample Y range of the previous shape
  let minY = Infinity, maxY = -Infinity;
  for (const v of prevVertices) {
    const r = rotatePoint(v, prevAngle);
    const wy = prevPosition.y + r.y;
    minY = Math.min(minY, wy);
    maxY = Math.max(maxY, wy);
  }
  
  // Return a function that gives max X at a given Y
  return (y) => {
    if (y < minY || y > maxY) return -Infinity;
    return getMaxXAtY(prevVertices, prevAngle, y - prevPosition.y) + prevPosition.x;
  };
}

/**
 * Check if a shape overlaps with the previous shape
 * Returns the amount of overlap (positive) that needs to be corrected
 */
function checkOverlap(currentVertices, currentAngle, currentPosition, prevVertices, prevAngle, prevPosition) {
  let maxOverlap = 0;
  
  // Get function to find previous shape's rightmost X at any Y
  const prevMaxXAtY = getMaxXAtAnyY(prevVertices, prevAngle, prevPosition);
  
  // Check all vertices of the current shape
  for (const v of currentVertices) {
    const r = rotatePoint(v, currentAngle);
    const worldX = currentPosition.x + r.x;
    const worldY = currentPosition.y + r.y;
    
    // Find previous shape's rightmost X at this Y level
    const prevRightX = prevMaxXAtY(worldY);
    
    // If current shape extends to the left of previous shape's right edge, there's overlap
    if (worldX < prevRightX) {
      const overlap = prevRightX - worldX;
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
      }
    }
  }
  
  // Check all edges of the current shape
  for (let i = 0; i < currentVertices.length; i++) {
    const v1 = rotatePoint(currentVertices[i], currentAngle);
    const v2 = rotatePoint(currentVertices[(i + 1) % currentVertices.length], currentAngle);
    const w1x = currentPosition.x + v1.x;
    const w1y = currentPosition.y + v1.y;
    const w2x = currentPosition.x + v2.x;
    const w2y = currentPosition.y + v2.y;
    
    // Sample points along this edge to check for overlap
    const steps = 20; // Sample 20 points along each edge
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const edgeX = w1x + t * (w2x - w1x);
      const edgeY = w1y + t * (w2y - w1y);
      
      const prevRightX = prevMaxXAtY(edgeY);
      
      if (edgeX < prevRightX) {
        const overlap = prevRightX - edgeX;
        if (overlap > maxOverlap) {
          maxOverlap = overlap;
        }
      }
    }
  }
  
  return maxOverlap;
}

/**
 * Place shapes so they touch at path edges - no gaps, no overlaps.
 * Shapes rotate around their center points, which are aligned horizontally.
 */
export function placeShapes(shapeDataList, order, rotations) {
  const placed = [];
  const BASELINE_Y = 0; // All shape centers align at this Y coordinate
  
  let contactX = 0;

  for (let i = 0; i < order.length; i++) {
    const idx = order[i];
    const { vertices } = shapeDataList[idx];
    const angle = rotations[i];

    // Find the minimum X coordinate this shape reaches at BASELINE_Y
    // This ensures we find the actual leftmost edge at the baseline
    const minXAtBaseline = getMinXAtY(vertices, angle, BASELINE_Y);
    
    // If shape doesn't cross baseline Y, use the leftmost point overall
    const { leftmost } = getExtents(vertices, angle);
    const leftContactX = minXAtBaseline !== Infinity ? minXAtBaseline : leftmost.x;
    
    // Position shape so its left edge at BASELINE_Y touches the contact point
    // Since center is at (0,0), position.y = BASELINE_Y keeps center aligned
    let posX = contactX - leftContactX;
    const posY = BASELINE_Y;

    // Check for overlap with previous shape and adjust if needed
    if (i > 0) {
      const prevShape = placed[i - 1];
      const overlap = checkOverlap(
        vertices, angle, { x: posX, y: posY },
        prevShape.vertices, prevShape.rotation, prevShape.position
      );
      if (overlap > 0) {
        // Adjust position to eliminate overlap
        posX += overlap;
      }
    }

    placed.push({
      vertices,
      position: { x: posX, y: posY },
      rotation: angle,
    });

    // Find the maximum X coordinate this shape reaches at BASELINE_Y
    // This is where the next shape should contact
    const maxXAtBaseline = getMaxXAtY(vertices, angle, BASELINE_Y);
    const { rightmost } = getExtents(vertices, angle);
    const rightContactX = maxXAtBaseline !== -Infinity ? maxXAtBaseline : rightmost.x;
    
    // Update contact point for next shape
    contactX = posX + rightContactX;
  }

  return { placed, bounds: { right: contactX } };
}
