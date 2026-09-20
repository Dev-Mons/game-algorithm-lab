import { penetration } from './contacts';
import type { GeometryMetrics, ParticleState } from './types';

/** Independent geometry measurement. No repair mask or transfer density is read.
 * Raster disk union -> isotropic closing at 0.5d -> bounded horizontal bridges
 * for this single horizontal corridor. Bridges detect the top-open crack too.
 * Components must contain a physically verified empty disk of radius >= 0.5d.
 * Reported void area is the post-closing component area, not field deficit.
 */
export function measureGeometry(state: ParticleState, frameX = 0, h = .25): GeometryMetrics {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < state.x.length; i++) {
    minX = Math.min(minX,state.x[i]!-frameX-state.radius[i]!);
    maxX = Math.max(maxX,state.x[i]!-frameX+state.radius[i]!);
    minY = Math.min(minY,state.y[i]!-state.radius[i]!); maxY = Math.max(maxY,state.y[i]!+state.radius[i]!);
  }
  const ox = Math.floor((minX-2)/h)*h, oy = Math.floor((minY-2)/h)*h;
  const width = Math.ceil((maxX+2-ox)/h), height = Math.ceil((maxY+2-oy)/h), n = width*height;
  const occupied = new Uint8Array(n);
  for (let a = 0; a < state.x.length; a++) {
    const x = state.x[a]!-frameX, y = state.y[a]!, r = state.radius[a]!;
    for (let iy = Math.max(0,Math.floor((y-r-oy)/h)); iy <= Math.min(height-1,Math.floor((y+r-oy)/h)); iy++) {
      for (let ix = Math.max(0,Math.floor((x-r-ox)/h)); ix <= Math.min(width-1,Math.floor((x+r-ox)/h)); ix++) {
        if ((ox+(ix+.5)*h-x)**2+(oy+(iy+.5)*h-y)**2 <= r*r) occupied[iy*width+ix] = 1;
      }
    }
  }
  const offsets: [number,number][] = [];
  const radius = Math.ceil(.5/h);
  for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
    if ((x*h)**2+(y*h)**2 <= .25+1e-12) offsets.push([x,y]);
  }
  const morph = (input: Uint8Array,dilate: boolean): Uint8Array => {
    const out = new Uint8Array(n);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let value = !dilate;
      for (const [dx,dy] of offsets) {
        const ix = x+dx, iy = y+dy;
        const v = ix >= 0 && ix < width && iy >= 0 && iy < height && input[iy*width+ix] === 1;
        if (dilate ? v : !v) { value = dilate; break; }
      }
      out[y*width+x] = value ? 1 : 0;
    }
    return out;
  };
  const closed = morph(morph(occupied,true),false), support = closed.slice();
  // Flood-fill the exterior of the closed union, retaining truly enclosed holes.
  const external = new Uint8Array(n), queue = new Int32Array(n);
  let head = 0, tail = 0;
  const enqueue = (c: number) => { if (!closed[c] && !external[c]) { external[c] = 1; queue[tail++] = c; } };
  for (let x = 0; x < width; x++) { enqueue(x); enqueue((height-1)*width+x); }
  for (let y = 0; y < height; y++) { enqueue(y*width); enqueue(y*width+width-1); }
  while (head < tail) {
    const c = queue[head++]!;
    if (c%width) enqueue(c-1); if (c%width+1 < width) enqueue(c+1);
    if (c >= width) enqueue(c-width); if (c+width < n) enqueue(c+width);
  }
  for (let c = 0; c < n; c++) if (!external[c]) support[c] = 1;
  for (let y = 0; y < height; y++) {
    let previous = -1;
    for (let x = 0; x < width; x++) if (closed[y*width+x]) {
      if (previous >= 0 && (x-previous)*h <= 6) {
        for (let k = previous+1; k < x; k++) support[y*width+k] = 1;
      }
      previous = x;
    }
  }
  const visited = new Uint8Array(n);
  let voidArea = 0, largestVoidArea = 0, maxEmptyRadius = 0, voidCount = 0;
  for (let start = 0; start < n; start++) {
    if (!support[start] || closed[start] || visited[start]) continue;
    head = 0; tail = 1; queue[0] = start; visited[start] = 1;
    let clearance = 0;
    while (head < tail) {
      const c = queue[head++]!, x = ox+(c%width+.5)*h+frameX, y = oy+(Math.floor(c/width)+.5)*h;
      let nearest = Infinity;
      for (let a = 0; a < state.x.length; a++) nearest = Math.min(nearest,
        Math.hypot(x-state.x[a]!,y-state.y[a]!)-state.radius[a]!);
      clearance = Math.max(clearance,nearest);
      for (const k of [c%width ? c-1 : -1,c%width+1 < width ? c+1 : -1,c-width,c+width]) {
        if (k >= 0 && k < n && support[k] && !closed[k] && !visited[k]) {
          visited[k] = 1; queue[tail++] = k;
        }
      }
    }
    if (clearance >= .5 && tail*h*h >= Math.PI*.25) {
      const area = tail*h*h;
      voidArea += area; largestVoidArea = Math.max(largestVoidArea,area);
      maxEmptyRadius = Math.max(maxEmptyRadius,clearance); voidCount++;
    }
  }
  return {voidArea,largestVoidArea,maxEmptyRadius,voidCount,
    footprintArea: support.reduce((s,v) => s+v,0)*h*h,extentX: maxX-minX,extentY: maxY-minY,
    mass: state.mass.reduce((a,b) => a+b,0),penetration: penetration(state)};
}
