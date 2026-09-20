import { AreaTransfer } from './area-transfer';
import { contactRows, penetration, sweptPenetration } from './contacts';
import { interiorRepair } from './interior-repair';
import { projectVelocity } from './projection';
import { stateFromScene } from './types';
import type { ParticleScene, ParticleState, ProjectionResult } from './types';
import { validateScene } from './fixtures';

export interface StepStats {
  iterations: number; primal: number; stationarity: number; complementarity: number;
  maxSlack: number; actualDensityViolation: number; penetration: number; sweptPenetration: number;
  maxSpeed: number; maxObservedSpeed: number; maxAcceleration: number;
  massError: number; fluxBalance: number; substeps: number; failedSteps: number;
}
const emptyStats = (): StepStats => ({iterations: 0,primal: 0,stationarity: 0,complementarity: 0,
  maxSlack: 0,actualDensityViolation: 0,penetration: 0,sweptPenetration: 0,maxSpeed: 0,
  maxObservedSpeed: 0,maxAcceleration: 0,massError: 0,fluxBalance: 0,substeps: 1,failedSteps: 0});

export class ParticleSimulation {
  readonly state: ParticleState;
  readonly field = new AreaTransfer(40,40);
  private readonly trialField = new AreaTransfer(40,40);
  private repairVelocity: Float64Array;
  readonly maxSpeed: number;
  readonly cap = .82;
  readonly timings = {transfer: 0,repair: 0,projection: 0,endpoint: 0,geometry: 0};
  readonly retries: {step: number; substeps: number; reason: string}[] = [];
  time = 0;
  steps = 0;
  failure: string | null = null;
  stats = emptyStats();
  readonly maxima = emptyStats();
  constructor(readonly scene: ParticleScene, readonly repair: boolean, readonly dt = 1/60) {
    validateScene(scene);
    if (!Number.isFinite(dt) || dt <= 0 || dt > 1/30) throw new Error('Reference dt must be in (0, 1/30]');
    this.state = stateFromScene(scene);
    this.maxSpeed = 1.2*scene.speed;
    this.repairVelocity = new Float64Array(this.state.velocity.length);
    this.field.scatter(this.state);
  }
  step(): boolean {
    if (this.failure) return false;
    const {state} = this;
    const oldX = state.x.slice(), oldY = state.y.slice(), oldV = state.velocity.slice();
    const oldRepair = this.repairVelocity.slice(), oldTime = this.time;
    let reason = '';
    for (const substeps of [1,2,4]) {
      state.x.set(oldX); state.y.set(oldY); state.velocity.set(oldV);
      this.repairVelocity.set(oldRepair); this.time = oldTime; this.stats = emptyStats();
      this.stats.substeps = substeps;
      let accepted = true;
      for (let s = 0; s < substeps; s++) {
        reason = this.substep(this.dt/substeps);
        if (reason) { accepted = false; break; }
        this.time += this.dt/substeps;
      }
      if (accepted) {
        this.steps++;
        for (const key of Object.keys(this.stats) as (keyof StepStats)[]) {
          this.maxima[key] = Math.max(this.maxima[key],this.stats[key]);
        }
        return true;
      }
      this.retries.push({step: this.steps,substeps,reason});
    }
    state.x.set(oldX); state.y.set(oldY); state.velocity.fill(0); this.repairVelocity.set(oldRepair);
    this.time = oldTime; this.failure = reason; this.stats.failedSteps = 1; this.maxima.failedSteps++;
    return false;
  }
  private recordSolve(solve: ProjectionResult): void {
    for (const key of ['iterations','primal','stationarity','complementarity','maxSlack'] as const) {
      this.stats[key] = Math.max(this.stats[key],solve[key]);
    }
  }
  private substep(dt: number): string {
    const {state,scene,field} = this;
    let timer = performance.now();
    field.scatter(state,scene.speed*this.time);
    this.timings.transfer += performance.now()-timer;
    timer = performance.now();
    const repair = this.repair ? interiorRepair(field,state,scene,dt) : null;
    if (repair?.insufficientMass) return 'insufficient_mass';
    this.stats.fluxBalance = Math.max(this.stats.fluxBalance,Math.abs(repair?.fluxBalance ?? 0));
    const preferred = state.velocity.slice();
    for (let a = 0; a < state.x.length; a++) {
      let bx = (repair?.velocity[2*a] ?? 0)-this.repairVelocity[2*a]!;
      let by = (repair?.velocity[2*a+1] ?? 0)-this.repairVelocity[2*a+1]!;
      let scale = Math.min(1,scene.speed*dt/Math.max(1e-30,Math.hypot(bx,by)));
      this.repairVelocity[2*a] = this.repairVelocity[2*a]!+bx*scale;
      this.repairVelocity[2*a+1] = this.repairVelocity[2*a+1]!+by*scale;
      bx = (scene.speed+this.repairVelocity[2*a]!-state.velocity[2*a]!)*(1-Math.exp(-dt/.35));
      by = (this.repairVelocity[2*a+1]!-state.velocity[2*a+1]!)*(1-Math.exp(-dt/.35));
      scale = Math.min(1,2*scene.speed*dt/Math.max(1e-30,Math.hypot(bx,by)));
      preferred[2*a] = preferred[2*a]!+bx*scale; preferred[2*a+1] = preferred[2*a+1]!+by*scale;
    }
    this.timings.repair += performance.now()-timer;
    timer = performance.now();
    const rows = [...field.constraints(dt,scene.speed,this.cap),...contactRows(state,dt,this.maxSpeed,scene.world)];
    const solve = projectVelocity(preferred,state.mass,rows,this.maxSpeed);
    this.recordSolve(solve);
    this.timings.projection += performance.now()-timer;
    if (!solve.converged) return 'solver_unconverged';
    const trial: ParticleState = {...state,x: state.x.slice(),y: state.y.slice(),velocity: solve.velocity};
    for (let a = 0; a < state.x.length; a++) {
      trial.x[a] = state.x[a]!+dt*solve.velocity[2*a]!;
      trial.y[a] = state.y[a]!+dt*solve.velocity[2*a+1]!;
    }
    timer = performance.now();
    const overlap = penetration(trial,scene.world), swept = sweptPenetration(state,solve.velocity,dt);
    this.stats.penetration = Math.max(this.stats.penetration,overlap);
    this.stats.sweptPenetration = Math.max(this.stats.sweptPenetration,swept);
    this.timings.geometry += performance.now()-timer;
    if (Math.max(overlap,swept) > 1e-7) return 'geometry_residual';
    timer = performance.now();
    this.trialField.scatter(trial,scene.speed*(this.time+dt));
    const slack = new Float64Array(field.phi.length);
    rows.forEach((row,i) => { if (row.cell !== undefined) slack[row.cell] = solve.slack[i]!; });
    let densityViolation = 0;
    for (let c = 0; c < slack.length; c++) densityViolation = Math.max(densityViolation,
      this.trialField.phi[c]!-this.cap-slack[c]!);
    this.stats.actualDensityViolation = Math.max(this.stats.actualDensityViolation,densityViolation);
    const particleMass = state.mass.reduce((a,b) => a+b,0);
    this.stats.massError = Math.max(this.stats.massError,
      Math.abs(this.trialField.phi.reduce((a,b) => a+b,0)*field.h**2-particleMass)/particleMass);
    this.timings.transfer += performance.now()-timer;
    if (densityViolation > 1e-3) return 'nonlinear_density_residual';
    // Stored transport is another joint projection at the endpoint. Positions
    // are NOT integrated again, and there is deliberately no position bias.
    timer = performance.now();
    const endRows = [...this.trialField.constraints(dt,scene.speed,this.cap),
      ...contactRows(trial,dt,this.maxSpeed,scene.world,true)];
    const endpoint = projectVelocity(solve.velocity,state.mass,endRows,this.maxSpeed);
    this.recordSolve(endpoint);
    this.timings.endpoint += performance.now()-timer;
    if (!endpoint.converged) return 'endpoint_unconverged';
    for (let a = 0; a < state.x.length; a++) {
      this.stats.maxSpeed = Math.max(this.stats.maxSpeed,Math.hypot(endpoint.velocity[2*a]!,endpoint.velocity[2*a+1]!));
      this.stats.maxObservedSpeed = Math.max(this.stats.maxObservedSpeed,Math.hypot(solve.velocity[2*a]!,solve.velocity[2*a+1]!));
      this.stats.maxAcceleration = Math.max(this.stats.maxAcceleration,
        Math.hypot(endpoint.velocity[2*a]!-state.velocity[2*a]!,endpoint.velocity[2*a+1]!-state.velocity[2*a+1]!)/dt);
    }
    state.x.set(trial.x); state.y.set(trial.y); state.velocity.set(endpoint.velocity);
    return '';
  }
}
