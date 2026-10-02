# Plinko Pusher Lab

- Run this project's commands from `Physics/PlinkoPusher`.
- `src/core` and `src/physics` must not import Three.js or browser APIs. `src/core` must not import physics engines.
- The plinko contract is board-local 2D (u right, v down, gravity +v). Never assume the board lies on a world plane; use `BoardFrame` for world conversion.
- Physics backends report facts only (peg contact, arrival, tray exit, loss). Rewards, de-duplication and caps live in `GameCore`.
- Keep custom and engine backends behind `PlinkoBackend` / `PusherBackend`; renderer and core must not touch engine World/Body/Collider types.
- Run `npm run verify` for rule or physics changes, `npm run measure` for performance claims, and `npm run test:e2e` for view or UI changes.
