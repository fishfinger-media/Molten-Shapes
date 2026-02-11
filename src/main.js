const BASE_HEIGHT = 240;

const SHAPES = [
  { id: 'solid', src: '/Shapes/solid.svg', width: 366, height: 366 },
  { id: 'liquid', src: '/Shapes/liquid.svg', width: 520, height: 520 },
  { id: 'gas', src: '/Shapes/gas.svg', width: 312, height: 312 },
  { id: 'plasma', src: '/Shapes/plasma.svg', width: 442, height: 441 },
];

const container = document.getElementById('shapes-container');
const transformControls = document.getElementById('transform-controls');
const stage = document.getElementById('stage');
const downloadBtn = document.getElementById('download-btn');

const HANDLE_NAMES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

let shapeWraps = [];
let shapeBaseSize = []; // per shape: { w, h } intrinsic size in px
let shapeSamples = [];  // per shape: [{ x, y }...] sampled along SVG path in wrap-local pixels
let shapeSnapAngles = []; // per shape: array of preferred rotation angles in degrees
let scales = [1, 1, 1, 1];
// Start the first shape (solid square) rotated 45deg so it appears as a diamond.
let rotations = [45, 0, 0, 0];
let selectedIndex = null;
let boundsEl;
let handleEls = {};

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
  wrap.appendChild(svgEl);
  shapeBaseSize[index] = { w, h: BASE_HEIGHT };

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
    selectShape(index);
  });

  return wrap;
}

function selectShape(index) {
  selectedIndex = index;
  transformControls.classList.toggle('visible', index !== null);
  updateDebugAngle();
  if (index !== null) {
    updateLayout();
    updateControlsPosition();
  }
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
  el.textContent = `${shapeId} · rotation: ${rot}° (normalized: ${norm}°)${liquidNote}`;
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

// Liquid gets the negative-margin correction at 135° only (not -135°/225°, 45°, 90°, etc).
// leftOffset/rightOffset are always min/max X after rotation, so we inset 25% from each side.
function isLiquidAt135Rotation(shapeIndex) {
  if (SHAPES[shapeIndex].id !== 'liquid') return false;
  const rot = normalizeAngleDeg(rotations[shapeIndex]);
  return Math.abs(rot - 135) < 0.01;
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

  shapeWraps.forEach((wrap, i) => {
    wrap.style.left = `${lefts[i] - minLeft}px`;
    wrap.style.top = `${tops[i] - minTop}px`;
  });

  if (selectedIndex !== null) {
    requestAnimationFrame(() => updateControlsPosition());
  }
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
  const targetW = 2000;
  const scale = targetW / totalW;
  const targetH = Math.round(totalH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#eaedef';
  ctx.fillRect(0, 0, targetW, targetH);

  const drawNext = (idx) => {
    if (idx >= shapeWraps.length) {
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'molten-shapes.png';
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
    const r = wrap.getBoundingClientRect();
    const w = r.width * scale;
    const h = r.height * scale;
    const drawX = (parseFloat(wrap.style.left) || 0) * scale;
    const drawY = (parseFloat(wrap.style.top) || 0) * scale;
    const s = scales[idx];
    const rot = rotations[idx];

    const svgClone = svg.cloneNode(true);
    svgClone.setAttribute('width', String(w / s));
    svgClone.setAttribute('height', String(h / s));
    const svgData = new XMLSerializer().serializeToString(svgClone);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      ctx.save();
      const originX = drawX + w / 2;
      const originY = drawY + h / 2;
      ctx.translate(originX, originY);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.scale(s, s);
      ctx.translate(-originX, -originY);
      ctx.drawImage(img, drawX, drawY, w / s, h / s);
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

async function init() {
  initTransformControls();

  for (let i = 0; i < SHAPES.length; i++) {
    const shape = SHAPES[i];
    const svgEl = await fetchSVGContent(shape.src);
    const wrap = buildShapeWrap(svgEl, i);
    container.appendChild(wrap);
    shapeWraps.push(wrap);
  }

  updateLayout();
  requestAnimationFrame(ensureSamplesBuilt);

  const showBoundsCheckbox = document.getElementById('show-bounds');
  if (showBoundsCheckbox) {
    showBoundsCheckbox.addEventListener('change', () => {
      const visible = showBoundsCheckbox.checked;
      shapeWraps.forEach((wrap) =>
        wrap.classList.toggle('debug-bounds-visible', visible),
      );
    });
  }

  document.addEventListener('click', (e) => {
    if (selectedIndex == null) return;
    if (
      e.target.closest('.shape-wrap') ||
      e.target.closest('.handle') ||
      e.target.closest('.rotate-handle') ||
      e.target.closest('#transform-controls')
    ) {
      return;
    }
    if (e.target.closest('#download-btn')) return;
    selectShape(null);
  });
}

downloadBtn.addEventListener('click', exportImage);
window.addEventListener('resize', () => {
  updateLayout();
  if (selectedIndex !== null) updateControlsPosition();
});

init();
