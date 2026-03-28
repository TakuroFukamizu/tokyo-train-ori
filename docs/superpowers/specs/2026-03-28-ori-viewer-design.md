# Ori Viewer Design

## Overview

Vite + TypeScript + Three.js web app that displays a wireframe cube called "ori" (おり) in 3D. The user can rotate and zoom with mouse controls. The ori is rendered as a skeleton (edges only) so objects can be placed inside it later.

## Tech Stack

- Vite + TypeScript (build / dev server)
- Three.js (3D rendering)
- OrbitControls (mouse interaction)

## Ori Representation

- `BoxGeometry` creates the cube shape
- `EdgesGeometry` + `LineSegments` renders edges only (no faces)
- Fully transparent skeleton — interior is visible from all angles
- Designed to contain additional objects in the future

## File Structure

```
web/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── main.ts        # Entry point: scene, camera, renderer, ori
    └── style.css      # Base styles
```

## Scene Setup

- Camera: `PerspectiveCamera`, positioned at an angle above the ori
- Lighting: None (wireframe lines don't need lights)
- Background: Dark gray (`#1a1a1a`)
- Ground: `GridHelper` for spatial reference
- Controls: `OrbitControls` for rotate / zoom / pan

## Future Considerations

- The scene structure supports adding meshes inside the ori
- The ori size and line color can be parameterized later
