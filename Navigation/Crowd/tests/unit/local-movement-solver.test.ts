import { describe, expect, it } from 'vitest';
import {
  LocalMovementSolver,
  type LocalMovementInput,
  type LocalMovementOutput,
  type LocalSteeringIntent,
} from '../../src/algorithms/steering/local-movement-solver';

function blockedFollowerInput(): LocalMovementInput {
  const neighborX = new Float64Array([20, 30]);
  const neighborY = new Float64Array([50, 50]);
  const neighborVelocityX = new Float64Array([86, 0]);
  const neighborVelocityY = new Float64Array(2);
  return {
    agentIndex: 0,
    positionX: 20,
    positionY: 50,
    velocityX: 86,
    velocityY: 0,
    preferredX: 1,
    preferredY: 0,
    distanceToGoal: 500,
    maxSpeed: 86,
    maxAcceleration: 210,
    fixedDelta: 1 / 60,
    arrivalSlowRadius: 150,
    agentRadius: 3.2,
    agentGap: 0.4,
    wallMargin: 0.35,
    avoidanceHorizon: 0.3,
    avoidanceBiasSeconds: 0.8,
    avoidanceSide: 1,
    avoidanceHold: 0.8,
    neighborCount: 1,
    neighborIndices: new Int32Array([1]),
    neighborX,
    neighborY,
    neighborVelocityX,
    neighborVelocityY,
    obstacles: [],
    worldWidth: 100,
    worldHeight: 100,
    obstacleLookAhead: 0.3,
  };
}

function steeringIntent(): LocalSteeringIntent {
  return {
    directionX: 0,
    directionY: 0,
    avoidanceSide: 0,
    avoidanceHold: 0,
    blocked: false,
    forwardClearance: Number.POSITIVE_INFINITY,
  };
}

function obstacleDeadlockInput(
  agentIndex: number,
  positionX: number,
  positionY: number,
  preferredX: number,
  preferredY: number,
): LocalMovementInput {
  return {
    agentIndex,
    positionX,
    positionY,
    velocityX: 0,
    velocityY: 0,
    preferredX,
    preferredY,
    distanceToGoal: 625,
    maxSpeed: 86,
    maxAcceleration: 210,
    fixedDelta: 1 / 60,
    arrivalSlowRadius: 90,
    agentRadius: 3.2,
    agentGap: 0.4,
    // Includes the simulation's 0.06 static-contact skin.
    wallMargin: 0.41,
    avoidanceHorizon: 0.3,
    avoidanceBiasSeconds: 0.8,
    avoidanceSide: 0,
    avoidanceHold: 0,
    neighborCount: 0,
    neighborIndices: new Int32Array(0),
    neighborX: new Float64Array(0),
    neighborY: new Float64Array(0),
    neighborVelocityX: new Float64Array(0),
    neighborVelocityY: new Float64Array(0),
    obstacles: [{ x: 504, y: 120, width: 72, height: 480 }],
    worldWidth: 1200,
    worldHeight: 720,
    obstacleLookAhead: 86 / 210 + 0.25,
  };
}

describe('kinematic local movement solver', () => {
  it('avoids a stopped agent without selecting reverse velocity', () => {
    const solver = new LocalMovementSolver();
    const input = blockedFollowerInput();
    const output: LocalMovementOutput = { x: 0, y: 0, avoidanceSide: 0, avoidanceHold: 0 };
    solver.solve(input, output);
    expect(output.x).toBeGreaterThanOrEqual(0);
    expect(output.x).toBeLessThanOrEqual(86);
    expect(output.y).toBeGreaterThan(0);
    expect(output.avoidanceSide).toBe(1);
    expect(Math.hypot(output.x - input.velocityX, output.y - input.velocityY))
      .toBeLessThanOrEqual(input.maxAcceleration * input.fixedDelta + 1e-9);
  });

  it('chooses a deterministic separating velocity for coincident centers', () => {
    const solver = new LocalMovementSolver();
    const input = blockedFollowerInput();
    input.agentIndex = 1;
    input.neighborIndices[0] = 0;
    input.velocityX = 40;
    input.neighborX[0] = input.positionX;
    input.neighborY[0] = input.positionY;
    input.neighborVelocityX[0] = 40;
    const output: LocalMovementOutput = { x: 0, y: 0, avoidanceSide: 0, avoidanceHold: 0 };
    solver.solve(input, output);
    expect(output.x).toBeGreaterThanOrEqual(0);
    expect(output.y).toBeGreaterThan(0);
  });

  it('keeps the same lateral bias instead of alternating every solve', () => {
    const solver = new LocalMovementSolver();
    const input = blockedFollowerInput();
    const output: LocalMovementOutput = { x: 0, y: 0, avoidanceSide: 0, avoidanceHold: 0 };
    const lateralSigns: number[] = [];
    for (let frame = 0; frame < 30; frame += 1) {
      solver.solve(input, output);
      if (Math.abs(output.y) > 1e-6) lateralSigns.push(Math.sign(output.y));
      input.avoidanceSide = output.avoidanceSide;
      input.avoidanceHold = output.avoidanceHold;
    }
    expect(lateralSigns.length).toBeGreaterThan(0);
    expect(new Set(lateralSigns)).toEqual(new Set([1]));
  });

  it('slows or stops in a narrow corridor when neither side is safe', () => {
    const solver = new LocalMovementSolver();
    const input = blockedFollowerInput();
    input.neighborX[0] = 34;
    input.obstacles = [
      { x: 0, y: 0, width: 100, height: 46 },
      { x: 0, y: 54, width: 100, height: 46 },
    ];
    const output: LocalMovementOutput = { x: 0, y: 0, avoidanceSide: 0, avoidanceHold: 0 };
    solver.solve(input, output);
    expect(output.x).toBeGreaterThanOrEqual(0);
    expect(output.x).toBeLessThan(86);
    expect(Math.abs(output.y)).toBeLessThan(1e-9);
  });

  it('preserves the exact preferred direction when the forward corridor is open', () => {
    const solver = new LocalMovementSolver();
    const input = blockedFollowerInput();
    input.positionX = 150;
    input.positionY = 150;
    input.preferredX = 3;
    input.preferredY = 4;
    input.velocityX = 0;
    input.velocityY = 0;
    input.neighborCount = 0;
    input.neighborIndices = new Int32Array(0);
    input.worldWidth = 300;
    input.worldHeight = 300;
    input.avoidanceSide = 0;
    input.avoidanceHold = 0;
    const intent = steeringIntent();

    solver.planIntent(input, intent);

    expect(intent.blocked).toBe(false);
    expect(intent.directionX).toBeCloseTo(0.6, 12);
    expect(intent.directionY).toBeCloseTo(0.8, 12);
  });

  it('steers through the rounded top-left corner instead of blocking its expanded-AABB square', () => {
    const solver = new LocalMovementSolver();
    const input = obstacleDeadlockInput(
      481,
      500.5042492595945,
      118.32445204238847,
      0.985004615,
      -0.172527993,
    );
    const intent = steeringIntent();
    const output: LocalMovementOutput = { x: 0, y: 0, avoidanceSide: 0, avoidanceHold: 0 };

    solver.planIntent(input, intent);
    solver.resolveVelocity(input, intent, output);

    expect(intent.blocked).toBe(true);
    expect(intent.directionX).toBeGreaterThan(0);
    expect(intent.directionY).toBeLessThan(0);
    expect(intent.forwardClearance).toBeGreaterThan(1e-4);
    expect(Math.hypot(output.x, output.y)).toBeGreaterThan(0);
    expect(output.x * input.preferredX + output.y * input.preferredY).toBeGreaterThan(0);
    expect(Math.hypot(output.x, output.y))
      .toBeLessThanOrEqual(input.maxAcceleration * input.fixedDelta + 1e-9);
  });

  it('moves tangentially away from the rounded left face when starting at exact clearance', () => {
    const solver = new LocalMovementSolver();
    const input = obstacleDeadlockInput(
      529,
      500.39,
      590.7173601749719,
      0.934813093,
      0.355140087,
    );
    const intent = steeringIntent();
    const output: LocalMovementOutput = { x: 0, y: 0, avoidanceSide: 0, avoidanceHold: 0 };

    solver.planIntent(input, intent);
    solver.resolveVelocity(input, intent, output);

    expect(intent.blocked).toBe(true);
    expect(intent.directionY).toBeGreaterThan(0);
    expect(intent.forwardClearance).toBeGreaterThan(1e-4);
    expect(Math.hypot(output.x, output.y)).toBeGreaterThan(0);
    expect(output.x * input.preferredX + output.y * input.preferredY).toBeGreaterThan(0);
    expect(Math.hypot(output.x, output.y))
      .toBeLessThanOrEqual(input.maxAcceleration * input.fixedDelta + 1e-9);
  });

  it('selects the nearest geometric free-gap boundary instead of a fixed angle sample', () => {
    const solver = new LocalMovementSolver();
    const input = blockedFollowerInput();
    input.positionX = 50;
    input.positionY = 50;
    input.neighborX[1] = 70;
    input.neighborY[1] = 50;
    input.worldWidth = 200;
    input.worldHeight = 100;
    input.avoidanceSide = 1;
    input.avoidanceHold = 0;
    const intent = steeringIntent();

    solver.planIntent(input, intent);

    const blockedRadius = input.agentRadius * 2 + input.agentGap;
    const expectedTangent = Math.asin(blockedRadius / 20) + Math.PI / 360;
    const selectedAngle = Math.atan2(intent.directionY, intent.directionX);
    expect(intent.blocked).toBe(true);
    expect(selectedAngle).toBeCloseTo(expectedTangent, 10);
    expect(selectedAngle).not.toBeCloseTo(Math.PI / 9, 3);
  });

  it('takes the only open side without stopping when the opposite side is bounded by a wall', () => {
    const solver = new LocalMovementSolver();
    const input = blockedFollowerInput();
    const clearance = input.agentRadius + input.wallMargin;
    input.positionX = 50;
    input.positionY = clearance;
    input.velocityX = 30;
    input.velocityY = 0;
    input.neighborX[1] = 70;
    input.neighborY[1] = clearance;
    input.worldWidth = 200;
    input.worldHeight = 100;
    input.avoidanceSide = -1;
    input.avoidanceHold = 0;
    const intent = steeringIntent();
    const output: LocalMovementOutput = { x: 0, y: 0, avoidanceSide: 0, avoidanceHold: 0 };

    solver.planIntent(input, intent);
    solver.resolveVelocity(input, intent, output);

    expect(intent.blocked).toBe(true);
    expect(intent.directionY).toBeGreaterThan(0);
    expect(intent.avoidanceSide).toBe(1);
    expect(Math.hypot(output.x, output.y)).toBeGreaterThan(0);
    expect(output.x).toBeGreaterThanOrEqual(0);
    expect(output.y).toBeGreaterThan(0);
  });

  it('brakes continuously and respects acceleration and turn-rate limits', () => {
    const solver = new LocalMovementSolver();
    const brakingInput = blockedFollowerInput();
    brakingInput.neighborX[1] = 34;
    brakingInput.obstacles = [
      { x: 0, y: 0, width: 100, height: 46 },
      { x: 0, y: 54, width: 100, height: 46 },
    ];
    let previousSpeed = Math.hypot(brakingInput.velocityX, brakingInput.velocityY);
    for (let frame = 0; frame < 12; frame += 1) {
      const output: LocalMovementOutput = { x: 0, y: 0, avoidanceSide: 0, avoidanceHold: 0 };
      solver.solve(brakingInput, output);
      const velocityDelta = Math.hypot(
        output.x - brakingInput.velocityX,
        output.y - brakingInput.velocityY,
      );
      const speed = Math.hypot(output.x, output.y);
      expect(velocityDelta)
        .toBeLessThanOrEqual(brakingInput.maxAcceleration * brakingInput.fixedDelta + 1e-9);
      expect(speed).toBeLessThanOrEqual(previousSpeed + 1e-9);
      expect(output.x).toBeGreaterThanOrEqual(0);
      expect(output.emergencyStop).not.toBe(true);
      brakingInput.velocityX = output.x;
      brakingInput.velocityY = output.y;
      brakingInput.avoidanceSide = output.avoidanceSide;
      brakingInput.avoidanceHold = output.avoidanceHold;
      previousSpeed = speed;
    }
    expect(previousSpeed).toBeGreaterThan(0);
    expect(previousSpeed).toBeLessThan(86);

    const turningInput = blockedFollowerInput();
    turningInput.positionX = 50;
    turningInput.positionY = 50;
    turningInput.velocityX = 40;
    turningInput.velocityY = 0;
    turningInput.neighborX[1] = 70;
    turningInput.neighborY[1] = 50;
    turningInput.worldWidth = 200;
    turningInput.worldHeight = 100;
    turningInput.avoidanceHold = 0;
    turningInput.maxTurnRate = 0.6;
    const turningOutput: LocalMovementOutput = { x: 0, y: 0, avoidanceSide: 0, avoidanceHold: 0 };
    solver.solve(turningInput, turningOutput);
    const headingDelta = Math.abs(Math.atan2(turningOutput.y, turningOutput.x));
    expect(turningOutput.y).toBeGreaterThan(0);
    expect(headingDelta)
      .toBeLessThanOrEqual(turningInput.maxTurnRate * turningInput.fixedDelta + 1e-9);
    expect(Math.hypot(turningOutput.x - 40, turningOutput.y))
      .toBeLessThanOrEqual(turningInput.maxAcceleration * turningInput.fixedDelta + 1e-9);
  });

  it('classifies an infeasible no-reverse projection as an emergency correction', () => {
    const solver = new LocalMovementSolver();
    const input = blockedFollowerInput();
    input.velocityX = -86;
    input.velocityY = 0;
    input.preferredX = 1;
    input.preferredY = 0;
    input.neighborCount = 0;
    input.neighborIndices = new Int32Array(0);
    input.worldWidth = 300;
    input.worldHeight = 100;
    const intent = steeringIntent();
    const output: LocalMovementOutput = { x: 0, y: 0, avoidanceSide: 0, avoidanceHold: 0 };

    solver.planIntent(input, intent);
    solver.resolveVelocity(input, intent, output);

    expect(output.x * input.preferredX + output.y * input.preferredY).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(output.x - input.velocityX, output.y - input.velocityY))
      .toBeGreaterThan(input.maxAcceleration * input.fixedDelta);
    expect(output.emergencyStop).toBe(true);

    input.velocityX = -2;
    solver.planIntent(input, intent);
    solver.resolveVelocity(input, intent, output);
    expect(output.x * input.preferredX + output.y * input.preferredY).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(output.x - input.velocityX, output.y - input.velocityY))
      .toBeLessThanOrEqual(input.maxAcceleration * input.fixedDelta + 1e-9);
    expect(output.emergencyStop).toBe(false);
  });

  it('shares head-on intents and does not flip avoidance side while the hold is active', () => {
    const solvers = [new LocalMovementSolver(), new LocalMovementSolver()];
    const positionsX = new Float64Array([40, 60]);
    const positionsY = new Float64Array([50, 50]);
    const velocitiesX = new Float64Array([30, -30]);
    const velocitiesY = new Float64Array(2);
    const avoidanceSides = new Int8Array(2);
    const avoidanceHolds = new Float64Array(2);
    const intents = [steeringIntent(), steeringIntent()];
    const outputs: LocalMovementOutput[] = [
      { x: 0, y: 0, avoidanceSide: 0, avoidanceHold: 0 },
      { x: 0, y: 0, avoidanceSide: 0, avoidanceHold: 0 },
    ];
    let previousIntentVelocityX = new Float64Array(velocitiesX);
    let previousIntentVelocityY = new Float64Array(velocitiesY);
    let sideFlipsDuringHold = 0;
    let sawOppositeWorldLateralMotion = false;

    const inputFor = (
      agent: number,
      intentVelocityX: Float64Array,
      intentVelocityY: Float64Array,
    ): LocalMovementInput => ({
      agentIndex: agent,
      positionX: positionsX[agent]!,
      positionY: positionsY[agent]!,
      velocityX: velocitiesX[agent]!,
      velocityY: velocitiesY[agent]!,
      preferredX: agent === 0 ? 1 : -1,
      preferredY: 0,
      distanceToGoal: 500,
      maxSpeed: 86,
      maxAcceleration: 210,
      fixedDelta: 1 / 60,
      arrivalSlowRadius: 150,
      agentRadius: 3.2,
      agentGap: 0.4,
      wallMargin: 0.35,
      avoidanceHorizon: 0.3,
      avoidanceBiasSeconds: 0.8,
      avoidanceSide: avoidanceSides[agent]!,
      avoidanceHold: avoidanceHolds[agent]!,
      neighborCount: 1,
      neighborIndices: new Int32Array([1 - agent]),
      neighborX: positionsX,
      neighborY: positionsY,
      neighborVelocityX: velocitiesX,
      neighborVelocityY: velocitiesY,
      neighborIntentVelocityX: intentVelocityX,
      neighborIntentVelocityY: intentVelocityY,
      selfIntentVelocityX: intentVelocityX[agent]!,
      selfIntentVelocityY: intentVelocityY[agent]!,
      maxTurnRate: 4.5,
      obstacles: [],
      worldWidth: 100,
      worldHeight: 100,
      obstacleLookAhead: 0.3,
    });

    for (let frame = 0; frame < 24; frame += 1) {
      const previousSides = new Int8Array(avoidanceSides);
      const previousHolds = new Float64Array(avoidanceHolds);
      for (let agent = 0; agent < 2; agent += 1) {
        solvers[agent]!.planIntent(
          inputFor(agent, previousIntentVelocityX, previousIntentVelocityY),
          intents[agent]!,
        );
        if (previousHolds[agent]! > 0 && intents[agent]!.avoidanceSide !== previousSides[agent]!) {
          sideFlipsDuringHold += 1;
        }
      }

      const sharedIntentVelocityX = new Float64Array(2);
      const sharedIntentVelocityY = new Float64Array(2);
      for (let agent = 0; agent < 2; agent += 1) {
        const plannedSpeed = Math.max(30, Math.hypot(velocitiesX[agent]!, velocitiesY[agent]!));
        sharedIntentVelocityX[agent] = intents[agent]!.directionX * plannedSpeed;
        sharedIntentVelocityY[agent] = intents[agent]!.directionY * plannedSpeed;
      }
      for (let agent = 0; agent < 2; agent += 1) {
        solvers[agent]!.resolveVelocity(
          inputFor(agent, sharedIntentVelocityX, sharedIntentVelocityY),
          intents[agent]!,
          outputs[agent]!,
        );
      }

      sawOppositeWorldLateralMotion ||= outputs[0]!.y * outputs[1]!.y < 0;
      for (let agent = 0; agent < 2; agent += 1) {
        positionsX[agent] = positionsX[agent]! + outputs[agent]!.x * (1 / 60);
        positionsY[agent] = positionsY[agent]! + outputs[agent]!.y * (1 / 60);
        velocitiesX[agent] = outputs[agent]!.x;
        velocitiesY[agent] = outputs[agent]!.y;
        avoidanceSides[agent] = outputs[agent]!.avoidanceSide;
        avoidanceHolds[agent] = outputs[agent]!.avoidanceHold;
      }
      previousIntentVelocityX = sharedIntentVelocityX;
      previousIntentVelocityY = sharedIntentVelocityY;
    }

    expect(intents[0]!.avoidanceSide).toBe(intents[1]!.avoidanceSide);
    expect(intents[0]!.avoidanceSide).not.toBe(0);
    expect(sideFlipsDuringHold).toBe(0);
    expect(sawOppositeWorldLateralMotion).toBe(true);
  });
});
