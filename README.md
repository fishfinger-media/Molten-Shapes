# Molten Shapes

A simple web app that generates random compositions of four SVG shapes in a row. Shapes touch edge-to-edge with no gaps, and each arrangement uses one of each shape with random order and rotation.

## Setup

```bash
npm install
npm run dev
```

Open http://localhost:5173 (or the port Vite shows).

## Usage

- **Random** – Shuffle the four shapes and apply random rotations
- **Export PNG** – Download the current composition as a 1000px-wide PNG with transparent background

## Customization

Edit `src/config.js` to change:

- `shapeColor` – Fill color for shapes (default: `#3c23e6`)
- `backgroundColor` – Background (default: `transparent`)
- `normalizedHeight` – Size of shapes (default: `200`)
- `exportWidth` – PNG export width (default: `1000`)

Future options (colors, drop shadows, etc.) can be added to the config and wired into the renderer.

## Project Structure

```
├── public/
│   └── Shapes/          # SVG assets
├── src/
│   ├── config.js       # App configuration
│   ├── shapeUtils.js   # SVG loading, point sampling, normalization
│   ├── placement.js    # Geometric placement (shapes touch)
│   ├── renderer.js     # Canvas rendering
│   └── main.js         # Entry point
└── index.html
```
