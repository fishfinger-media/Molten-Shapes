const BASE_HEIGHT = 240;
const BACKGROUND_GREY = '#eaedef';
const INSET_FILTERS = ['inset-blue', 'inset-green', 'inset-yellow', 'inset-red'];
const GLOW_PX = 10; // fixed glow thickness in screen pixels
const GLOW_BLEED_PX = GLOW_PX + 4; // bleed overlay glow thickness (4px thicker)
// Bleed overlay colors by state: liquid=blue, gas=green, plasma=yellow (no bleed for solid)
const BLEED_FILTER_SOURCES = ['inset-blue', 'inset-green', 'inset-yellow']; // for shape indices 1, 2, 3
// Glow colour options: this shape's glow bleeds into the next shape
const GLOW_COLOR_NAMES = ['blue', 'green', 'yellow', 'red'];
const GLOW_COLOR_RGB = [
  'rgba(6,35,230,1)',
  'rgba(0,229,110,1)',
  'rgba(255,255,64,1)',
  'rgba(255,128,126,1)',
];
const BLEED_CIRCLE_DIAMETER = 222; // px; circle masks the overlay (2 * default R)
const BLEED_CIRCLE_R = BLEED_CIRCLE_DIAMETER / 2;
const BLEED_CIRCLE_FEATHER = 60;   // px; soft edge (fade from solid to transparent)

const SHAPES = [
  { id: 'solid', src: '/Shapes/solid.svg', width: 366, height: 366 },
  { id: 'liquid', src: '/Shapes/liquid.svg', width: 520, height: 520 },
  { id: 'gas', src: '/Shapes/gas.svg', width: 312, height: 312 },
  { id: 'plasma', src: '/Shapes/plasma.svg', width: 442, height: 441 },
];

const container = document.getElementById('shapes-container');
const shapesGroup = document.getElementById('shapes-group');
const transformControls = document.getElementById('transform-controls');
const stage = document.getElementById('stage');
const paperEl = document.getElementById('paper');
const downloadBtn = document.getElementById('download-btn');

// 300 DPI: 1 inch = 25.4 mm, 300 px per inch → mm * (300/25.4) ≈ mm * 11.811
const DPI = 300;
const MM_TO_PX = DPI / 25.4;
const PAPER_SPECS = {
  'a4-landscape': { w: 297 * MM_TO_PX, h: 210 * MM_TO_PX },
  'a4-portrait': { w: 210 * MM_TO_PX, h: 297 * MM_TO_PX },
  'a5-landscape': { w: 210 * MM_TO_PX, h: 148 * MM_TO_PX },
  'a5-portrait': { w: 148 * MM_TO_PX, h: 210 * MM_TO_PX },
};

const HANDLE_NAMES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

let shapeWraps = [];
let bleedOverlayWraps = []; // [undefined, el1, el2, el3] - fixed clip-path layer for overlay (no transform)
let bleedOverlayInner = []; // inner div with scale/rotate for overlay SVG
let shapeBaseSize = []; // per shape: { w, h } intrinsic size in px
let shapeSamples = [];  // per shape: [{ x, y }...] sampled along SVG path in wrap-local pixels
let shapeSnapAngles = []; // per shape: array of preferred rotation angles in degrees
let scales = [0.658, 1.450, 0.741, 1.075];
let rotations = [45, 0, 0, 0];
let selectedIndex = null;
let boundsEl;
let handleEls = {};

let paperType = 'a4-landscape';
let groupScale = 100;
let groupRotation = 0;
let groupTranslateX = 0;
let groupTranslateY = 0;

// Layout values for bleed overlay positioning (set in updateLayout)
let layoutLefts = [];
let layoutTops = [];
let layoutMinLeft = 0;
let layoutMinTop = 0;
let layoutTotalHeight = 0;
let layoutContainerOffsets = []; // per-shape { leftOffset, rightOffset, topOffset, bottomOffset } in wrap-local (rotated bbox)

// Debug: bleed circle position (tune with sliders; use output values in code)
// Layer is expanded by R on all sides so the circle is never cut. Cx = offset from shape left edge (0 = left edge).
let debugCircleCx = 0;    // px from shape left edge (circle center in layer = R + this)
let debugCircleCy = 50;   // % of layer height (50 = center) – fallback when per-shape not set
let debugCircleCyByShape = [50, 50, 42, 50]; // [unused, liquid, gas, plasma] Y % per shape
let debugCircleR = 111;   // radius in px (default for liquid/gas)
let debugCircleRByShape = [111, 111, 111, 127]; // [unused, liquid, gas, plasma] radius per shape (plasma 127)
// Glow colour per shape (0=blue, 1=green, 2=yellow, 3=red). This shape's colour bleeds into the next.
let glowColorByShapeIndex = [0, 1, 2, 3]; // [solid, liquid, gas, plasma] → plasma red by default

let panStartX = 0;
let panStartY = 0;
let panStartTranslateX = 0;
let panStartTranslateY = 0;
let isPanning = false;
let hasPanned = false;
let ignoreNextShapeClick = false; // set when user dragged; prevents click from showing transforms
const PAN_THRESHOLD_PX = 5;
let panStartShapeWrap = null;

function widthAtHeight(vw, vh, h) {
  return (vw / vh) * h;
}

async function fetchSVGContent(url) {
  const res = await fetch(url);
  const text = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'image/svg+xml');
  return doc.querySelector('svg');
}

function getShapeContentBounds(svgEl, wrapWidth, wrapHeight) {
  const viewBox = svgEl.getAttribute('viewBox');
  const vb = viewBox
    ? viewBox.split(/\s+/).map(Number)
    : [
        0,
        0,
        parseInt(svgEl.getAttribute('width'), 10) || 100,
        parseInt(svgEl.getAttribute('height'), 10) || 100,
      ];
  const vw = vb[2] - vb[0];
  const vh = vb[3] - vb[1];
  const scaleX = wrapWidth / vw;
  const scaleY = wrapHeight / vh;
  let bbox;
  try {
    bbox = svgEl.getBBox
      ? svgEl.getBBox()
      : { x: vb[0], y: vb[1], width: vw, height: vh };
  } catch (_) {
    bbox = { x: vb[0], y: vb[1], width: vw, height: vh };
  }
  return {
    left: (bbox.x - vb[0]) * scaleX,
    top: (bbox.y - vb[1]) * scaleY,
    right: (bbox.x + bbox.width - vb[0]) * scaleX,
    bottom: (bbox.y + bbox.height - vb[1]) * scaleY,
  };
}

function buildSamplesForShape(index, svgEl, wrapWidth, wrapHeight) {
  if (!svgEl) return;
  const path = svgEl.querySelector('path');
  const viewBox = svgEl.getAttribute('viewBox');
  const vb = viewBox
    ? viewBox.split(/\s+/).map(Number)
    : [0, 0, wrapWidth, wrapHeight];
  const vw = vb[2] - vb[0];
  const vh = vb[3] - vb[1];
  const scaleX = wrapWidth / vw;
  const scaleY = wrapHeight / vh;

  function bboxCornersInWrapPixels() {
    let bbox;
    try {
      bbox =
        path && path.getBBox
          ? path.getBBox()
          : { x: vb[0], y: vb[1], width: vw, height: vh };
    } catch (_) {
      bbox = { x: vb[0], y: vb[1], width: vw, height: vh };
    }
    return [
      { x: (bbox.x - vb[0]) * scaleX, y: (bbox.y - vb[1]) * scaleY },
      {
        x: (bbox.x + bbox.width - vb[0]) * scaleX,
        y: (bbox.y - vb[1]) * scaleY,
      },
      {
        x: (bbox.x + bbox.width - vb[0]) * scaleX,
        y: (bbox.y + bbox.height - vb[1]) * scaleY,
      },
      {
        x: (bbox.x - vb[0]) * scaleX,
        y: (bbox.y + bbox.height - vb[1]) * scaleY,
      },
    ];
  }

  const pts = [];

  if (path && typeof path.getTotalLength === 'function') {
    try {
      const total = path.getTotalLength();
      const steps = Math.max(128, Math.min(384, Math.ceil(total / 2)));
      for (let i = 0; i <= steps; i++) {
        const p = path.getPointAtLength((total * i) / steps);
        pts.push({
          x: (p.x - vb[0]) * scaleX,
          y: (p.y - vb[1]) * scaleY,
        });
      }
    } catch (_) {
      // ignore
    }
  }

  pts.push(...bboxCornersInWrapPixels());
  shapeSamples[index] = pts;
}

function normalizeAngleDeg(angle) {
  let a = angle % 360;
  if (a < -180) a += 360;
  if (a > 180) a -= 360;
  return a;
}

// Rotation locked to 45° increments only.
const SNAP_ANGLES_45 = [0, 45, 90, 135, 180, -135, -90, -45];

function buildSnapAnglesForShape(index, svgEl) {
  shapeSnapAngles[index] = [...SNAP_ANGLES_45];
}

function buildShapeWrap(svgEl, index) {
  const wrap = document.createElement('div');
  wrap.className = 'shape-wrap';
  wrap.dataset.index = String(index);
  wrap.setAttribute('role', 'button');
  wrap.setAttribute('tabindex', '0');
  wrap.setAttribute('aria-label', `Select ${SHAPES[index].id} shape`);

  const viewBox = svgEl.getAttribute('viewBox');
  const vb = viewBox
    ? viewBox.split(/\s+/).map(Number)
    : [
        0,
        0,
        parseInt(svgEl.getAttribute('width'), 10) || 100,
        parseInt(svgEl.getAttribute('height'), 10) || 100,
      ];
  const vw = vb[2] - vb[0];
  const vh = vb[3] - vb[1];
  const w = widthAtHeight(vw, vh, BASE_HEIGHT);

  svgEl.setAttribute('width', String(w));
  svgEl.setAttribute('height', String(BASE_HEIGHT));
  if (!svgEl.getAttribute('xmlns')) svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const path = svgEl.querySelector('path');
  if (path) {
    path.setAttribute('fill', 'white');
    path.setAttribute('filter', `url(#inset-filter-${index})`);
  }

  const shapeInner = document.createElement('div');
  shapeInner.className = 'shape-inner';
  shapeInner.appendChild(svgEl);

  wrap.appendChild(shapeInner);
  shapeBaseSize[index] = { w, h: BASE_HEIGHT };

  // Bleed overlay SVG (for non-solid): built here, caller will put it in a fixed clip-path layer so the circle doesn't rotate
  let overlaySvg = null;
  if (SHAPES[index].id !== 'solid') {
    overlaySvg = svgEl.cloneNode(true);
    overlaySvg.classList.add('shape-bleed');
    const overlayPath = overlaySvg.querySelector('path');
    if (overlayPath) {
      overlayPath.setAttribute('fill', 'white');
      overlayPath.setAttribute('filter', `url(#inset-bleed-filter-${index})`);
    }
  }
  wrap._bleedOverlaySvg = overlaySvg;

  // Precompute preferred snap angles for this shape based on its path.
  buildSnapAnglesForShape(index, svgEl);

  const contentBounds = getShapeContentBounds(svgEl, w, BASE_HEIGHT);
  const debugEl = document.createElement('div');
  debugEl.className = 'debug-bounds';
  debugEl.setAttribute('aria-hidden', 'true');
  debugEl.style.left = `${contentBounds.left}px`;
  debugEl.style.top = `${contentBounds.top}px`;
  debugEl.style.width = `${contentBounds.right - contentBounds.left}px`;
  debugEl.style.height = `${contentBounds.bottom - contentBounds.top}px`;
  wrap.appendChild(debugEl);

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('.handle') || e.target.closest('.rotate-handle')) return;
    if (ignoreNextShapeClick) {
      ignoreNextShapeClick = false;
      return;
    }
    selectShape(index);
  });

  return wrap;
}

function selectShape(index) {
  selectedIndex = index;
  transformControls.classList.toggle('visible', index !== null);
  updateDebugAngle();
  const colorSidebar = document.getElementById('shape-color-sidebar');
  if (colorSidebar) {
    colorSidebar.classList.toggle('hidden', index === null);
    if (index !== null) updateShapeColorSidebar();
  }
  if (index !== null) {
    updateLayout();
    updateControlsPosition();
  }
}

function updateShapeColorSidebar() {
  const titleEl = document.getElementById('shape-color-sidebar-title');
  const hintEl = document.getElementById('shape-color-sidebar-hint');
  const buttons = document.querySelectorAll('.shape-color-btn');
  if (selectedIndex == null) return;
  const shapeId = SHAPES[selectedIndex]?.id ?? 'shape';
  const label = shapeId.charAt(0).toUpperCase() + shapeId.slice(1);
  if (titleEl) titleEl.textContent = `${label} glow colour`;
  if (hintEl) hintEl.textContent = 'This colour bleeds into the next shape.';
  const current = glowColorByShapeIndex[selectedIndex];
  buttons.forEach((btn) => {
    const colorIndex = parseInt(btn.dataset.color, 10);
    btn.setAttribute('aria-pressed', colorIndex === current ? 'true' : 'false');
  });
}

function getSelectedRect() {
  if (selectedIndex == null || !shapeWraps[selectedIndex]) return null;
  const r = shapeWraps[selectedIndex].getBoundingClientRect();
  const stageR = stage.getBoundingClientRect();
  return {
    left: r.left - stageR.left,
    top: r.top - stageR.top,
    width: r.width,
    height: r.height,
    centerX: r.left - stageR.left + r.width / 2,
    centerY: r.top - stageR.top + r.height / 2,
  };
}

function updateDebugAngle() {
  const el = document.getElementById('debug-angle');
  if (!el) return;
  if (selectedIndex == null) {
    el.textContent = '';
    return;
  }
  const rot = rotations[selectedIndex];
  const norm = normalizeAngleDeg(rot);
  const shapeId = SHAPES[selectedIndex]?.id ?? '?';
  const liquidNote = shapeId === 'liquid' && isLiquidAt135Rotation(selectedIndex)
    ? ' (liquid neg-margin)'
    : '';
  const gasSide = getGasNegativeMarginSide(selectedIndex);
  const gasNote = shapeId === 'gas' && gasSide
    ? ` (gas neg-margin ${gasSide === 'both' ? 'both sides' : gasSide + ' side'})`
    : '';
  const scale = scales[selectedIndex];
  el.textContent = `${shapeId} · rotation: ${rot}° (normalized: ${norm}°) · scale: ${scale}${liquidNote}${gasNote}`;
}

function updateControlsPosition() {
  if (selectedIndex == null) return;
  const rect = getSelectedRect();
  if (!rect || !boundsEl) return;
  updateDebugAngle();

  transformControls.style.left = `${rect.left}px`;
  transformControls.style.top = `${rect.top}px`;
  transformControls.style.width = `${rect.width}px`;
  transformControls.style.height = `${rect.height}px`;

  const positions = {
    n: [50, 0], s: [50, 100], e: [100, 50], w: [0, 50],
    ne: [100, 0], nw: [0, 0], se: [100, 100], sw: [0, 100],
  };
  HANDLE_NAMES.forEach((name) => {
    const el = handleEls[name];
    if (!el) return;
    const [x, y] = positions[name];
    el.style.left = x === 50 ? '50%' : `${x}%`;
    el.style.top = y === 50 ? '50%' : `${y}%`;
    el.style.marginLeft = x === 50 ? '-4px' : x === 0 ? '0' : '-8px';
    el.style.marginTop = y === 50 ? '-4px' : y === 0 ? '0' : '-8px';
  });

  const rotateHandle = document.getElementById('rotate-handle');
  if (rotateHandle) {
    rotateHandle.style.left = '50%';
    rotateHandle.style.top = 'auto';
    rotateHandle.style.bottom = '100%';
    rotateHandle.style.marginLeft = '-14px';
    rotateHandle.style.marginBottom = '6px';
    rotateHandle.style.width = '28px';
    rotateHandle.style.height = '28px';
  }
}

function samplesToOffsets(samples, bw, bh, s, rDeg) {
  const r = (rDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const cx = bw / 2;
  const cy = bh / 2;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let leftPoint = null;
  let rightPoint = null;
  samples.forEach(({ x: px, y: py }) => {
    const relX = px - cx;
    const relY = py - cy;
    const containerX = cx + (relX * cos - relY * sin) * s;
    const containerY = cy + (relX * sin + relY * cos) * s;
    if (containerX < minX) {
      minX = containerX;
      leftPoint = { x: containerX, y: containerY };
    }
    if (containerX > maxX) {
      maxX = containerX;
      rightPoint = { x: containerX, y: containerY };
    }
    minY = Math.min(minY, containerY);
    maxY = Math.max(maxY, containerY);
  });
  if (!leftPoint) leftPoint = { x: minX, y: (minY + maxY) / 2 };
  if (!rightPoint) rightPoint = { x: maxX, y: (minY + maxY) / 2 };
  return {
    leftOffset: minX,
    rightOffset: maxX,
    topOffset: minY,
    bottomOffset: maxY,
    leftPoint,
    rightPoint,
  };
}

function contentBoundsToContainerOffsets(content, bw, bh, s, rDeg) {
  const corners = [
    { x: content.left, y: content.top },
    { x: content.right, y: content.top },
    { x: content.right, y: content.bottom },
    { x: content.left, y: content.bottom },
  ];
  return samplesToOffsets(corners, bw, bh, s, rDeg);
}

// Liquid gets the negative-margin correction at 135° and -45° (not -135°/225°, 45°, 90°, etc).
// leftOffset/rightOffset are always min/max X after rotation, so we inset 25% from each side.
function isLiquidAt135Rotation(shapeIndex) {
  if (SHAPES[shapeIndex].id !== 'liquid') return false;
  const rot = normalizeAngleDeg(rotations[shapeIndex]);
  return Math.abs(rot - 135) < 0.01 || Math.abs(rot - (-45)) < 0.01;
}

// Gas gets the negative-margin correction:
// - 45° and -135°: one side only (right for 45°, left for -135°)
// - 135° and -45°: both sides
function isGasAtNegativeMarginRotation(shapeIndex) {
  if (SHAPES[shapeIndex].id !== 'gas') return false;
  const rot = normalizeAngleDeg(rotations[shapeIndex]);
  return Math.abs(rot - 45) < 0.01 || Math.abs(rot - (-135)) < 0.01 
    || Math.abs(rot - 135) < 0.01 || Math.abs(rot - (-45)) < 0.01;
}

// Returns 'right' for 45°, 'left' for -135°, 'both' for 135° and -45°, or null if not applicable.
function getGasNegativeMarginSide(shapeIndex) {
  if (!isGasAtNegativeMarginRotation(shapeIndex)) return null;
  const rot = normalizeAngleDeg(rotations[shapeIndex]);
  if (Math.abs(rot - 45) < 0.01) return 'right';
  if (Math.abs(rot - (-135)) < 0.01) return 'left';
  if (Math.abs(rot - 135) < 0.01) return 'both';
  if (Math.abs(rot - (-45)) < 0.01) return 'both';
  return null;
}

function updateLayout() {
  if (!shapeWraps.length) return;

  shapeWraps.forEach((wrap, i) => {
    wrap.style.transform = `scale(${scales[i]}) rotate(${rotations[i]}deg)`;
    wrap.style.position = 'absolute';
    wrap.style.left = '0';
    wrap.style.top = '0';
  });

  const svgElements = shapeWraps.map((w) => w.querySelector('svg'));
  svgElements.forEach((svg, i) => {
    if (svg && shapeBaseSize[i]) {
      buildSamplesForShape(i, svg, shapeBaseSize[i].w, shapeBaseSize[i].h);
    }
  });

  const containerOffsets = shapeWraps.map((_, i) => {
    const samples = shapeSamples[i];
    const base = shapeBaseSize[i];
    if (!base) {
      return {
        leftOffset: 0,
        rightOffset: 0,
        topOffset: 0,
        bottomOffset: 0,
        leftPoint: { x: 0, y: 0 },
        rightPoint: { x: 0, y: 0 },
      };
    }
    if (samples && samples.length > 0) {
      return samplesToOffsets(samples, base.w, base.h, scales[i], rotations[i]);
    }
    const content = svgElements[i]
      ? getShapeContentBounds(svgElements[i], base.w, base.h)
      : { left: 0, top: 0, right: base.w, bottom: base.h };
    return contentBoundsToContainerOffsets(
      content,
      base.w,
      base.h,
      scales[i],
      rotations[i],
    );
  });

  // Liquid at 45°-type rotations: remove 25% from both sides (50% total) for layout
  // so it butts up to neighbors; keep the same center so positioning stays correct.
  containerOffsets.forEach((o, i) => {
    if (!isLiquidAt135Rotation(i)) return;
    const width = o.rightOffset - o.leftOffset;
    const inset = width * 0.25; // 25% from each side = 50% total
    o.leftOffset += inset;
    o.rightOffset -= inset;
    if (o.leftPoint) o.leftPoint.x = o.leftOffset;
    if (o.rightPoint) o.rightPoint.x = o.rightOffset;
  });

  // Gas negative margin correction:
  // - 45°: remove 13% from right side only
  // - -135°: remove 13% from left side only
  // - 135° and -45°: remove 13% from both sides
  containerOffsets.forEach((o, i) => {
    const side = getGasNegativeMarginSide(i);
    if (!side) return;
    const width = o.rightOffset - o.leftOffset;
    const inset = width * 0.15; // 15% from one or both sides
    if (side === 'right') {
      o.rightOffset -= inset;
      if (o.rightPoint) o.rightPoint.x = o.rightOffset;
    } else if (side === 'left') {
      o.leftOffset += inset;
      if (o.leftPoint) o.leftPoint.x = o.leftOffset;
    } else if (side === 'both') {
      o.leftOffset += inset;
      o.rightOffset -= inset;
      if (o.leftPoint) o.leftPoint.x = o.leftOffset;
      if (o.rightPoint) o.rightPoint.x = o.rightOffset;
    }
  });

  // Keep all shapes on a common horizontal alignment (same vertical center)
  // and ensure the right edge of shape i touches the left edge of shape i+1.
  const OVERLAP_EPSILON = 0.5;
  const lefts = [0];
  for (let i = 1; i < shapeWraps.length; i++) {
    const prev = containerOffsets[i - 1];
    const curr = containerOffsets[i];
    lefts.push(
      lefts[i - 1] + (prev.rightOffset - curr.leftOffset) - OVERLAP_EPSILON,
    );
  }

  const centersY = containerOffsets.map(
    (o) => (o.topOffset + o.bottomOffset) / 2,
  );
  const tops = containerOffsets.map((_, i) => -centersY[i]);

  const minLeft = Math.min(
    ...containerOffsets.map((o, i) => lefts[i] + o.leftOffset),
  );
  const maxRight = Math.max(
    ...containerOffsets.map((o, i) => lefts[i] + o.rightOffset),
  );
  const minTop = Math.min(
    ...containerOffsets.map((o, i) => tops[i] + o.topOffset),
  );
  const maxBottom = Math.max(
    ...containerOffsets.map((o, i) => tops[i] + o.bottomOffset),
  );

  const totalWidth = maxRight - minLeft;
  const totalHeight = maxBottom - minTop;
  container.style.width = `${totalWidth}px`;
  container.style.height = `${totalHeight}px`;

  layoutLefts = lefts;
  layoutTops = tops;
  layoutMinLeft = minLeft;
  layoutMinTop = minTop;
  layoutTotalHeight = totalHeight;
  layoutContainerOffsets = containerOffsets.map((o) => ({
    leftOffset: o.leftOffset,
    rightOffset: o.rightOffset,
    topOffset: o.topOffset,
    bottomOffset: o.bottomOffset,
  }));

  shapeWraps.forEach((wrap, i) => {
    wrap.style.left = `${lefts[i] - minLeft}px`;
    wrap.style.top = `${tops[i] - minTop}px`;
  });

  updateGroupTransform();
  updateShapeFilters();
  updateBleedOverlayPositions();

  if (selectedIndex !== null) {
    requestAnimationFrame(() => updateControlsPosition());
  }
}

// Update filter radius/stdDeviation so glow is fixed GLOW_PX regardless of shape size/scale
function updateShapeFilters() {
  const defs = document.querySelector('svg defs');
  if (!defs) return;
  const gs = groupScale / 100;
  shapeWraps.forEach((_, i) => {
    const filterEl = document.getElementById(`inset-filter-${i}`);
    if (!filterEl) return;
    const viewBoxDim = Math.max(SHAPES[i].width, SHAPES[i].height);
    const s = scales[i] * gs;
    const radius = (GLOW_PX * viewBoxDim) / (BASE_HEIGHT * s);
    const stdDev = radius * (26 / 20);
    const morph = filterEl.querySelector('feMorphology');
    const blur = filterEl.querySelector('feGaussianBlur');
    if (morph) morph.setAttribute('radius', String(Math.max(1, radius)));
    if (blur) blur.setAttribute('stdDeviation', String(Math.max(1, stdDev)));

    // Bleed overlay filter (4px thicker glow) for liquid, gas, plasma
    if (SHAPES[i].id === 'solid') return;
    const bleedFilterEl = document.getElementById(`inset-bleed-filter-${i}`);
    if (!bleedFilterEl) return;
    const bleedRadius = (GLOW_BLEED_PX * viewBoxDim) / (BASE_HEIGHT * s);
    const bleedStdDev = bleedRadius * (26 / 20);
    const bleedMorph = bleedFilterEl.querySelector('feMorphology');
    const bleedBlur = bleedFilterEl.querySelector('feGaussianBlur');
    if (bleedMorph) bleedMorph.setAttribute('radius', String(Math.max(1, bleedRadius)));
    if (bleedBlur) bleedBlur.setAttribute('stdDeviation', String(Math.max(1, bleedStdDev)));
  });
}

// Bleed overlay layers: size and position from the shape's rotated bbox so the circle stays at the shape's left edge at any rotation.
function updateBleedOverlayPositions() {
  const gs = groupScale / 100;
  shapeWraps.forEach((_, i) => {
    const layer = bleedOverlayWraps[i];
    const inner = bleedOverlayInner[i];
    if (!layer || !inner) return;
    const base = shapeBaseSize[i];
    const off = layoutContainerOffsets[i];
    if (!base || !off) return;
    const R = debugCircleRByShape[i] ?? debugCircleR; // per-shape radius (e.g. plasma 127)
    const wrapLeft = layoutLefts[i] - layoutMinLeft;
    const wrapTop = layoutTops[i] - layoutMinTop;
    const { leftOffset, rightOffset, topOffset, bottomOffset } = off;
    // Layer sized to rotated bbox + 2*R so circle is never cut
    const layerW = (rightOffset - leftOffset) + 2 * R;
    const layerH = (bottomOffset - topOffset) + 2 * R;
    layer.style.left = `${wrapLeft + leftOffset - R}px`;
    layer.style.top = `${wrapTop + topOffset - R}px`;
    layer.style.width = `${layerW}px`;
    layer.style.height = `${layerH}px`;
    // SVG wrapper: position so shape center is at layer center (for correct scale/rotate origin)
    const svgWrap = layer.querySelector('.bleed-overlay-svg-wrap');
    if (svgWrap) {
      const wx = layerW / 2 - base.w / 2;
      const wy = layerH / 2 - BASE_HEIGHT / 2;
      svgWrap.style.left = `${wx}px`;
      svgWrap.style.top = `${wy}px`;
    }
    // Circle at left edge of rotated shape (feathered mask: solid to R-feather, then fade to R)
    const circleCx = layerW / 2 - base.w / 2 + leftOffset + debugCircleCx;
    const circleCy = debugCircleCyByShape[i] ?? debugCircleCy; // per-shape Y %
    const innerR = Math.max(0, R - BLEED_CIRCLE_FEATHER); // solid up to here, then fade
    const maskValue = `radial-gradient(circle ${R}px at ${circleCx}px ${circleCy}%, white 0px, white ${innerR}px, transparent ${R}px)`;
    layer.style.clipPath = '';
    layer.style.maskImage = maskValue;
    layer.style.webkitMaskImage = maskValue;
    layer.style.maskSize = '100% 100%';
    layer.style.maskRepeat = 'no-repeat';
    layer.style.webkitMaskSize = '100% 100%';
    layer.style.webkitMaskRepeat = 'no-repeat';
    const s = scales[i] * gs;
    inner.style.transform = `scale(${s}) rotate(${rotations[i]}deg)`;
    inner.style.transformOrigin = '50% 50%';
  });
}

function updateDebugCircleOutput() {
  const el = document.getElementById('debug-circle-output');
  if (!el) return;
  const rLiquid = debugCircleRByShape[1] ?? debugCircleR;
  const innerR = Math.max(0, rLiquid - BLEED_CIRCLE_FEATHER);
  el.textContent = `r liquid/gas ${rLiquid}px, plasma ${debugCircleRByShape[3]}px, feather ${BLEED_CIRCLE_FEATHER}px (solid 0→${innerR}px)`;
  el.title = [
    `Feather ${BLEED_CIRCLE_FEATHER}px. Radius: liquid ${debugCircleRByShape[1]}, gas ${debugCircleRByShape[2]}, plasma ${debugCircleRByShape[3]}.`,
    'Y %: liquid ' + debugCircleCyByShape[1] + ', gas ' + debugCircleCyByShape[2] + ', plasma ' + debugCircleCyByShape[3],
    'Use in code:',
    `  debugCircleCx = ${debugCircleCx};`,
    `  debugCircleCyByShape = [50, ${debugCircleCyByShape[1]}, ${debugCircleCyByShape[2]}, ${debugCircleCyByShape[3]}];`,
    `  debugCircleRByShape = [111, ${debugCircleRByShape[1]}, ${debugCircleRByShape[2]}, ${debugCircleRByShape[3]}];`,
  ].join('\n');
}

function updateGroupTransform() {
  if (!shapesGroup) return;
  shapesGroup.style.transform =
    `translate(${groupTranslateX}px, ${groupTranslateY}px) scale(${groupScale / 100}) rotate(${groupRotation}deg)`;
}

function updatePaperClass() {
  if (!paperEl) return;
  paperEl.classList.toggle('portrait', paperType === 'a4-portrait' || paperType === 'a5-portrait');
}

function onPaperPointerDown(e) {
  if (e.button !== 0) return;
  if (e.target.closest('#transform-controls')) return;
  isPanning = true;
  hasPanned = false;
  panStartShapeWrap = e.target.closest('.shape-wrap');
  document.body.classList.add('is-panning');
  panStartX = e.clientX;
  panStartY = e.clientY;
  panStartTranslateX = groupTranslateX;
  panStartTranslateY = groupTranslateY;
}

function onPaperPointerMove(e) {
  if (!isPanning) return;
  const dx = e.clientX - panStartX;
  const dy = e.clientY - panStartY;
  if (!hasPanned && (dx * dx + dy * dy > PAN_THRESHOLD_PX * PAN_THRESHOLD_PX)) {
    hasPanned = true;
  }
  if (hasPanned) {
    groupTranslateX = panStartTranslateX + dx;
    groupTranslateY = panStartTranslateY + dy;
    updateGroupTransform();
  }
}

function onPaperPointerUp() {
  if (isPanning) {
    document.body.classList.remove('is-panning');
    if (hasPanned) {
      ignoreNextShapeClick = true; // click will still fire on shape; ignore it so transforms don't show
    } else {
      if (panStartShapeWrap != null) {
        const idx = shapeWraps.indexOf(panStartShapeWrap);
        if (idx !== -1) selectShape(idx);
      } else {
        selectShape(null);
      }
    }
    panStartShapeWrap = null;
  }
  isPanning = false;
}

function initPaperPan() {
  if (!paperEl) return;
  paperEl.addEventListener('mousedown', onPaperPointerDown);
  document.addEventListener('mousemove', onPaperPointerMove);
  document.addEventListener('mouseup', onPaperPointerUp);
}

function ensureSamplesBuilt() {
  shapeWraps.forEach((wrap, i) => {
    const svg = wrap.querySelector('svg');
    if (svg && shapeBaseSize[i]) {
      buildSamplesForShape(i, svg, shapeBaseSize[i].w, shapeBaseSize[i].h);
    }
  });
  updateLayout();
}

function initTransformControls() {
  boundsEl = document.createElement('div');
  boundsEl.className = 'transform-bounds';
  transformControls.appendChild(boundsEl);

  HANDLE_NAMES.forEach((name) => {
    const el = document.createElement('div');
    el.className = `handle ${name}`;
    el.dataset.handle = name;
    el.addEventListener('mousedown', (e) => onHandleStart(e, name));
    handleEls[name] = el;
    transformControls.appendChild(el);
  });

  const rotateHandle = document.createElement('div');
  rotateHandle.id = 'rotate-handle';
  rotateHandle.className = 'rotate-handle';
  rotateHandle.title = 'Drag to rotate';
  rotateHandle.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"><path d="M12 4v4m0 8v4M4 12h4m8 0h4"/><path d="M7.05 7.05l2.83 2.83m6.24 6.24l2.83 2.83M7.05 16.95l2.83-2.83m6.24-6.24l2.83-2.83"/></svg>';
  rotateHandle.addEventListener('mousedown', onRotateStart);
  transformControls.appendChild(rotateHandle);
}

let dragStartX;
let dragStartY;
let startScale;
let startRotation;
let startAngle;

function snapRotationForShape(index, rawAngle) {
  const angles = shapeSnapAngles[index];
  if (!angles || !angles.length) return normalizeAngleDeg(rawAngle);

  const current = normalizeAngleDeg(rawAngle);
  let best = angles[0];
  let bestDiff = Math.abs(normalizeAngleDeg(current - best));
  for (let i = 1; i < angles.length; i++) {
    const diff = Math.abs(normalizeAngleDeg(current - angles[i]));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = angles[i];
    }
  }
  // Always snap to nearest 45° (no tolerance — rotation is locked to 45° increments).
  return best;
}

function onHandleStart(e, name) {
  e.preventDefault();
  e.stopPropagation();
  if (selectedIndex == null) return;
  const rect = getSelectedRect();
  if (!rect) return;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  startScale = scales[selectedIndex];

  function onMouseMove(ev) {
    const dx = ev.clientX - dragStartX;
    const dy = ev.clientY - dragStartY;
    let scaleX = 1;
    let scaleY = 1;
    if (name.includes('e')) scaleX = 1 + dx / (rect.width || 1);
    if (name.includes('w')) scaleX = 1 - dx / (rect.width || 1);
    if (name.includes('s')) scaleY = 1 + dy / (rect.height || 1);
    if (name.includes('n')) scaleY = 1 - dy / (rect.height || 1);
    let scaleFactor = 1;
    if (name === 'ne' || name === 'nw' || name === 'se' || name === 'sw') {
      scaleFactor = Math.min(scaleX, scaleY);
    } else if (name === 'e' || name === 'w') {
      scaleFactor = scaleX;
    } else {
      scaleFactor = scaleY;
    }
    scales[selectedIndex] = Math.max(0.2, Math.min(5, startScale * scaleFactor));
    updateLayout();
    dragStartX = ev.clientX;
    dragStartY = ev.clientY;
    startScale = scales[selectedIndex];
    const newRect = shapeWraps[selectedIndex].getBoundingClientRect();
    rect.width = newRect.width;
    rect.height = newRect.height;
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function onRotateStart(e) {
  e.preventDefault();
  e.stopPropagation();
  if (selectedIndex == null) return;
  // For the circle (last shape), allow only scaling, not rotation.
  if (SHAPES[selectedIndex] && SHAPES[selectedIndex].id === 'plasma') return;
  const rect = getSelectedRect();
  if (!rect) return;
  const stageR = stage.getBoundingClientRect();
  const centerX = stageR.left + rect.left + rect.width / 2;
  const centerY = stageR.top + rect.top + rect.height / 2;
  startRotation = rotations[selectedIndex];
  startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);

  // Sensitivity: 1 = 1:1 cursor movement to rotation. Higher = less drag needed to jump.
  const ROTATE_SENSITIVITY = 2.5;
  function onMouseMove(ev) {
    const angle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX);
    const deltaDeg = ((angle - startAngle) * 180) / Math.PI;
    const raw = startRotation + deltaDeg * ROTATE_SENSITIVITY;
    // Snap during drag so rotation is locked to 45° increments.
    rotations[selectedIndex] = snapRotationForShape(selectedIndex, raw);
    updateLayout();
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    if (selectedIndex != null) {
      const snapped = snapRotationForShape(selectedIndex, rotations[selectedIndex]);
      rotations[selectedIndex] = snapped;
      updateLayout();
    }
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function getTotalWidth() {
  const w = parseFloat(container.style.width);
  return Number.isFinite(w) ? w : 0;
}

function getTotalHeight() {
  const h = parseFloat(container.style.height);
  return Number.isFinite(h) ? h : BASE_HEIGHT;
}

function exportImage() {
  const totalW = getTotalWidth();
  const totalH = getTotalHeight();
  if (totalW <= 0) return;

  const spec = PAPER_SPECS[paperType];
  const paperW = Math.round(spec.w);
  const paperH = Math.round(spec.h);
  const gs = groupScale / 100;
  const rad = (groupRotation * Math.PI) / 180;

  // Map UI paper viewport to export pixels (match what user sees, don't fit shapes)
  const paperRect = paperEl.getBoundingClientRect();
  const scaleToExportX = paperW / paperRect.width;
  const scaleToExportY = paperH / paperRect.height;
  const txExport = groupTranslateX * scaleToExportX;
  const tyExport = groupTranslateY * scaleToExportY;

  const canvas = document.createElement('canvas');
  canvas.width = paperW;
  canvas.height = paperH;
  const ctx = canvas.getContext('2d');

  ctx.save();
  ctx.rect(0, 0, paperW, paperH);
  ctx.clip();
  // Replicate UI: center of paper = transform origin, then pan, rotate, scale
  ctx.translate(paperW / 2, paperH / 2);
  ctx.translate(txExport, tyExport);
  ctx.rotate(rad);
  ctx.scale(scaleToExportX * gs, scaleToExportY * gs);
  ctx.translate(-totalW / 2, -totalH / 2);

  const drawNext = (idx) => {
    if (idx >= shapeWraps.length) {
      ctx.restore();
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `molten-shapes-${paperType}-300dpi.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
      return;
    }
    const wrap = shapeWraps[idx];
    const svg = wrap.querySelector('svg');
    if (!svg) {
      drawNext(idx + 1);
      return;
    }
    const base = shapeBaseSize[idx];
    if (!base) {
      drawNext(idx + 1);
      return;
    }
    const left = parseFloat(wrap.style.left) || 0;
    const top = parseFloat(wrap.style.top) || 0;
    const drawX = left;
    const drawY = top;
    const shapeScale = scales[idx];
    const rot = rotations[idx];
    const baseW = base.w;
    const baseH = base.h;

    const svgClone = svg.cloneNode(true);
    svgClone.setAttribute('width', String(baseW));
    svgClone.setAttribute('height', String(baseH));

    const filterId = `inset-filter-${idx}`;
    const filterEl = document.getElementById(filterId);
    if (filterEl) {
      let defs = svgClone.querySelector('defs');
      if (!defs) {
        defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        svgClone.insertBefore(defs, svgClone.firstChild);
      }
      defs.appendChild(filterEl.cloneNode(true));
    }

    const svgData = new XMLSerializer().serializeToString(svgClone);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      ctx.save();
      const originX = drawX + baseW / 2;
      const originY = drawY + baseH / 2;
      ctx.translate(originX, originY);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.scale(shapeScale, shapeScale);
      ctx.translate(-originX, -originY);
      ctx.drawImage(img, drawX, drawY, baseW, baseH);
      ctx.restore();
      URL.revokeObjectURL(url);
      drawNext(idx + 1);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      drawNext(idx + 1);
    };
    img.src = url;
  };

  drawNext(0);
}

function setFilterGlowColor(filterEl, rgb) {
  if (!filterEl) return;
  const flood = filterEl.querySelector('feFlood[result="shadowColor"]') || filterEl.querySelector('feFlood');
  if (flood) flood.setAttribute('flood-color', rgb);
}

// Apply glow colours: main shape i uses glowColorByShapeIndex[i]; bleed on shape i uses colour of shape i-1 (bleeds into this shape).
function applyGlowColors() {
  SHAPES.forEach((_, i) => {
    const filterEl = document.getElementById(`inset-filter-${i}`);
    if (filterEl) setFilterGlowColor(filterEl, GLOW_COLOR_RGB[glowColorByShapeIndex[i]]);
  });
  [1, 2, 3].forEach((i) => {
    const bleedEl = document.getElementById(`inset-bleed-filter-${i}`);
    if (bleedEl) setFilterGlowColor(bleedEl, GLOW_COLOR_RGB[glowColorByShapeIndex[i - 1]]);
  });
}

function initShapeFilters() {
  const defs = document.querySelector('svg defs');
  if (!defs) return;
  SHAPES.forEach((_, i) => {
    const baseFilter = document.getElementById(INSET_FILTERS[i]);
    if (!baseFilter) return;
    const clone = baseFilter.cloneNode(true);
    clone.id = `inset-filter-${i}`;
    defs.appendChild(clone);
  });
  // Bleed overlay filters (thicker glow) for liquid, gas, plasma only
  [1, 2, 3].forEach((i) => {
    const sourceId = BLEED_FILTER_SOURCES[i - 1];
    const baseFilter = document.getElementById(sourceId);
    if (!baseFilter) return;
    const clone = baseFilter.cloneNode(true);
    clone.id = `inset-bleed-filter-${i}`;
    defs.appendChild(clone);
  });
  applyGlowColors();
}

async function init() {
  initTransformControls();
  initPaperPan();
  initShapeFilters();

  for (let i = 0; i < SHAPES.length; i++) {
    const shape = SHAPES[i];
    const svgEl = await fetchSVGContent(shape.src);
    const wrap = buildShapeWrap(svgEl, i);
    container.appendChild(wrap);
    shapeWraps.push(wrap);

    // Bleed overlay in a separate layer: layer expanded by radius so circle is never cut
    if (wrap._bleedOverlaySvg) {
      const layer = document.createElement('div');
      layer.className = 'bleed-overlay-wrap';
      layer.dataset.index = String(i);
      layer.setAttribute('aria-hidden', 'true');
      const inner = document.createElement('div');
      inner.className = 'bleed-overlay-inner';
      const svgWrap = document.createElement('div');
      svgWrap.className = 'bleed-overlay-svg-wrap';
      svgWrap.appendChild(wrap._bleedOverlaySvg);
      inner.appendChild(svgWrap);
      layer.appendChild(inner);
      container.appendChild(layer);
      bleedOverlayWraps[i] = layer;
      bleedOverlayInner[i] = inner;
      delete wrap._bleedOverlaySvg;
    } else {
      bleedOverlayWraps[i] = null;
      bleedOverlayInner[i] = null;
    }
  }

  updateLayout();
  updatePaperClass();
  requestAnimationFrame(ensureSamplesBuilt);

  const paperTypeSelect = document.getElementById('paper-type');
  if (paperTypeSelect) {
    paperTypeSelect.value = paperType;
    paperTypeSelect.addEventListener('change', () => {
      paperType = paperTypeSelect.value;
      updatePaperClass();
    });
  }

  const scaleInput = document.getElementById('scale');
  const scaleValueEl = document.getElementById('scale-value');
  if (scaleInput) {
    scaleInput.value = groupScale;
    if (scaleValueEl) scaleValueEl.textContent = groupScale + '%';
    scaleInput.addEventListener('input', () => {
      groupScale = Number(scaleInput.value);
      if (scaleValueEl) scaleValueEl.textContent = groupScale + '%';
      updateGroupTransform();
      updateShapeFilters();
    });
  }

  const rotationInput = document.getElementById('rotation');
  const rotationValueEl = document.getElementById('rotation-value');
  if (rotationInput) {
    rotationInput.value = groupRotation;
    if (rotationValueEl) rotationValueEl.textContent = groupRotation + '°';
    rotationInput.addEventListener('input', () => {
      groupRotation = Number(rotationInput.value);
      if (rotationValueEl) rotationValueEl.textContent = groupRotation + '°';
      updateGroupTransform();
    });
  }

  // Debug: bleed circle position sliders (output values for use in code)
  function applyDebugCircleSliders() {
    updateBleedOverlayPositions();
    updateDebugCircleOutput();
  }
  const debugCx = document.getElementById('debug-circle-cx');
  const debugR = document.getElementById('debug-circle-r');
  if (debugCx) {
    debugCx.value = debugCircleCx;
    document.getElementById('debug-circle-cx-value').textContent = debugCircleCx;
    debugCx.addEventListener('input', () => {
      debugCircleCx = Number(debugCx.value);
      document.getElementById('debug-circle-cx-value').textContent = debugCircleCx;
      applyDebugCircleSliders();
    });
  }
  const cyShapeIds = [
    null,
    { input: 'debug-circle-cy-liquid', value: 'debug-circle-cy-liquid-value', index: 1 },
    { input: 'debug-circle-cy-gas', value: 'debug-circle-cy-gas-value', index: 2 },
    { input: 'debug-circle-cy-plasma', value: 'debug-circle-cy-plasma-value', index: 3 },
  ];
  cyShapeIds.forEach((entry) => {
    if (!entry) return;
    const inputEl = document.getElementById(entry.input);
    const valueEl = document.getElementById(entry.value);
    if (!inputEl || !valueEl) return;
    inputEl.value = debugCircleCyByShape[entry.index];
    valueEl.textContent = debugCircleCyByShape[entry.index];
    inputEl.addEventListener('input', () => {
      debugCircleCyByShape[entry.index] = Number(inputEl.value);
      valueEl.textContent = debugCircleCyByShape[entry.index];
      applyDebugCircleSliders();
    });
  });
  if (debugR) {
    debugR.value = debugCircleR;
    document.getElementById('debug-circle-r-value').textContent = debugCircleR;
    debugR.addEventListener('input', () => {
      debugCircleR = Number(debugR.value);
      debugCircleRByShape[1] = debugCircleR; // liquid
      debugCircleRByShape[2] = debugCircleR; // gas (plasma stays 127)
      document.getElementById('debug-circle-r-value').textContent = debugCircleR;
      applyDebugCircleSliders();
    });
  }
  updateDebugCircleOutput();

  document.querySelectorAll('.shape-color-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (selectedIndex == null) return;
      const colorIndex = parseInt(btn.dataset.color, 10);
      glowColorByShapeIndex[selectedIndex] = colorIndex;
      applyGlowColors();
      updateShapeColorSidebar();
    });
  });

  document.addEventListener('click', (e) => {
    if (selectedIndex == null) return;
    if (e.target.closest('#menu') || e.target.closest('#shape-color-sidebar')) return;
    if (
      e.target.closest('.shape-wrap') ||
      e.target.closest('.handle') ||
      e.target.closest('.rotate-handle') ||
      e.target.closest('#transform-controls')
    ) {
      return;
    }
    selectShape(null);
  });
}

if (downloadBtn) downloadBtn.addEventListener('click', exportImage);
window.addEventListener('resize', () => {
  updateLayout();
  if (selectedIndex !== null) updateControlsPosition();
});

init();
