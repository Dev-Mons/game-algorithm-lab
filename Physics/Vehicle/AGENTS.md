# Vehicle Physics Lab

- Run this project's commands from `Physics/Vehicle`.
- Implement physics independently of rendering; `src/physics` must not import Three.js or browser APIs.
- All courses and presets run the same four-wheel force solver. Change geometry and parameters, not solver selection.
- Use SI units in a right-handed frame: +Y up, +Z vehicle forward, +X driver's left. Positive driver steer turns right (negative physical Y rotation). Physics and rendering share the wheel angle.
- Preserve fixed-step reproducibility, unilateral ground support, airborne zero tire force, and bounded contact work.
- Run `npm run verify`, `npm run test:e2e`, and `npm run measure` for physics changes.
- Target: Toyful Games' custom raycast car video, https://www.youtube.com/watch?v=CdPYlj5uZeI.
