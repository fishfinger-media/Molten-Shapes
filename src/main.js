import { config } from './config.js';
import {
  samplePathPoints,
  createPathElement,
  parseSvgPath,
  normalizePoints,
  rotatePoint,
} from './shapeUtils.js';
import { placeShapes } from './placement.js';
import { renderToCanvas } from './renderer.js';

/** @type {Array<{ vertices: Array<{x: number, y: number}> }>} */
let shapeDataList = [];
let currentPlaced = [];

/**
 * Load and process a single SVG
 */
async function loadShape(filename) {
  const res = await fetch(`/Shapes/${filename}`);
  const text = await res.text();
  const pathData = parseSvgPath(text);
  const pathEl = createPathElement(pathData);
  const points = samplePathPoints(pathEl);
  const normalized = normalizePoints(points, config.normalizedHeight);
  return { vertices: normalized };
}

/**
 * Load all shapes
 */
async function loadAllShapes() {
  shapeDataList = await Promise.all(
    config.shapeFiles.map((f) => loadShape(f))
  );
}

/**
 * Fisher-Yates shuffle
 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Random angle in radians (0 to 2π)
 */
function randomAngle() {
  return Math.random() * Math.PI * 2;
}

/**
 * Generate new random arrangement
 */
function randomize() {
  const order = shuffle([0, 1, 2, 3]);
  const rotations = order.map(() => randomAngle());
  const { placed } = placeShapes(shapeDataList, order, rotations);
  currentPlaced = placed;
  return placed;
}

/**
 * Get composition bounds
 */
function getCompositionBoundsSync(placed) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of placed) {
    for (const v of s.vertices) {
      const r = rotatePoint(v, s.rotation);
      const wx = s.position.x + r.x;
      const wy = s.position.y + r.y;
      minX = Math.min(minX, wx);
      maxX = Math.max(maxX, wx);
      minY = Math.min(minY, wy);
      maxY = Math.max(maxY, wy);
    }
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

const PADDING = 40;
const MAX_DISPLAY_WIDTH = 1000;
const MAX_DISPLAY_HEIGHT = 400;

/**
 * Setup canvas size for display
 */
function setupCanvas(canvas, placed) {
  const bounds = getCompositionBoundsSync(placed);
  const scale = Math.min(
    1,
    (MAX_DISPLAY_WIDTH - PADDING * 2) / bounds.width,
    (MAX_DISPLAY_HEIGHT - PADDING * 2) / bounds.height
  );
  canvas.width = MAX_DISPLAY_WIDTH;
  canvas.height = MAX_DISPLAY_HEIGHT;
  return scale;
}

/**
 * Export as PNG at 1000px width
 */
function exportPng() {
  const bounds = getCompositionBoundsSync(currentPlaced);
  const targetWidth = config.exportWidth;
  const scale = (targetWidth - PADDING * 2) / bounds.width;
  const height = Math.ceil((bounds.height + PADDING * 2) * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = height;

  renderToCanvas(canvas, currentPlaced, scale);

  const link = document.createElement('a');
  link.download = `molten-shapes-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

/**
 * Main
 */
async function init() {
  await loadAllShapes();
  const canvas = document.getElementById('canvas');
  const randomBtn = document.getElementById('randomBtn');
  const exportBtn = document.getElementById('exportBtn');

  function render() {
    const scale = setupCanvas(canvas, currentPlaced);
    renderToCanvas(canvas, currentPlaced, scale);
  }

  randomBtn.addEventListener('click', () => {
    randomize();
    render();
  });

  exportBtn.addEventListener('click', exportPng);

  // Initial render
  randomize();
  render();
}

init().catch(console.error);
