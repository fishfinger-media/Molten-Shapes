/**
 * Utilities for loading SVGs and sampling path points
 */

const SAMPLES_PER_PATH = 120;

/**
 * Sample points along an SVG path using getPointAtLength
 */
export function samplePathPoints(pathElement) {
  const len = pathElement.getTotalLength();
  const points = [];
  for (let i = 0; i <= SAMPLES_PER_PATH; i++) {
    const pt = pathElement.getPointAtLength((i / SAMPLES_PER_PATH) * len);
    points.push({ x: pt.x, y: pt.y });
  }
  return points;
}

/**
 * Create an SVG path element from path data string
 */
export function createPathElement(d) {
  const ns = 'http://www.w3.org/2000/svg';
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  return path;
}

/**
 * Parse SVG string to extract path data
 */
export function parseSvgPath(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const path = doc.querySelector('path');
  if (!path) throw new Error('No path found in SVG');
  return path.getAttribute('d');
}

/**
 * Get bounding box of points
 */
export function getBounds(points) {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, cx: 0, cy: 0 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

/**
 * Center points around origin and scale to target height
 */
export function normalizePoints(points, targetHeight) {
  const bounds = getBounds(points);
  const scale = targetHeight / (bounds.height || 1);
  const cx = bounds.cx;
  const cy = bounds.cy;
  return points.map((p) => ({
    x: (p.x - cx) * scale,
    y: (p.y - cy) * scale,
  }));
}

/**
 * Rotate a point around origin
 */
export function rotatePoint(p, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: p.x * c - p.y * s,
    y: p.x * s + p.y * c,
  };
}
