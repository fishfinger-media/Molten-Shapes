/**
 * Canvas rendering
 */
import { rotatePoint } from './shapeUtils.js';
import { config } from './config.js';

/**
 * Draw a shape with a thick inset glow at the edges - no fill, no outline.
 * Uses clip + thick stroked path so the glow appears only inside the shape.
 */
function drawShape(ctx, vertices, position, rotation) {
  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.rotate(rotation);

  const drawPath = () => {
    ctx.beginPath();
    ctx.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i++) {
      ctx.lineTo(vertices[i].x, vertices[i].y);
    }
    ctx.closePath();
  };

  drawPath();
  ctx.clip(); // Glow only shows inside the shape

  drawPath();
  ctx.shadowColor = config.glowColor;
  ctx.shadowBlur = 200;
  ctx.strokeStyle = config.glowColor;
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.restore();
}

/**
 * Render all placed shapes to canvas
 */
export function renderToCanvas(canvas, placed, scale = 1) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (config.backgroundColor !== 'transparent') {
    ctx.fillStyle = config.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Compute composition bounds and center
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
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);

  for (const shape of placed) {
    drawShape(ctx, shape.vertices, shape.position, shape.rotation);
  }

  ctx.restore();
}
