import {expect,it} from 'vitest';
import {allocateParkingBudget,ParkingCharge,type BudgetComponent} from '../src/core/parking-budget';
it('reserves the exact stall bound and shares only 128 parent tickets/1.5M circulation expansions',()=>{
  const components:BudgetComponent[]=Array.from({length:8},(_,i)=>({componentKey:String(i),minimum:[i*2,0,0],stateCellBound:200,eligibleCells:144,trialCapacity:75,gateCount:4}));
  const ledger=allocateParkingBudget('lot',components);
  expect(ledger.allocations.every(a=>a.stallLimit===3*4*200+32*72)).toBe(true);
  expect(ledger.allocations.reduce((n,a)=>n+a.layoutTickets,0)).toBe(128);
  expect(ledger.allocations.reduce((n,a)=>n+a.circulationLimit,0)).toBe(1500000);
  expect(ledger.allocations.reduce((n,a)=>n+a.stallLimit,0)).toBeLessThanOrEqual(500000);
  expect(allocateParkingBudget('lot',[...components].reverse())).toEqual(ledger);
});
it('does not borrow protected stall work after circulation exhaustion; unused tickets are not fabricated',()=>{
  const ledger=allocateParkingBudget('lot',[{componentKey:'0',minimum:[0,0,0],stateCellBound:12,eligibleCells:8,trialCapacity:2,gateCount:1}]);
  expect(ledger.allocations[0].layoutTickets).toBe(2);
  const allocation={...ledger.allocations[0],circulationLimit:3},charge=new ParkingCharge(allocation);
  charge.circulation();charge.circulation();charge.circulation();expect(()=>charge.circulation()).toThrow('CIRCULATION_BUDGET_EXCEEDED');expect(charge.stallUsed).toBe(0);
  for(let i=0;i<allocation.stallLimit;i++)charge.stall();expect(charge.stallUsed).toBe(allocation.stallStateUpperBound);expect(()=>charge.stall()).toThrow('STALL_BUDGET_CONTRACT_VIOLATION');
});
it('reports unscheduled capacity distinctly and handles zero admitted components',()=>{
  const huge=allocateParkingBudget('lot',[{componentKey:'huge',minimum:[0,0,0],stateCellBound:500000,eligibleCells:1,trialCapacity:1,gateCount:1}]);
  expect(huge.allocations).toEqual([]);expect(huge.unscheduled[0].reason).toBe('STALL_BUDGET_NOT_RESERVED');
  const many=allocateParkingBudget('lot',Array.from({length:129},(_,i)=>({componentKey:String(i),minimum:[i,0,0],stateCellBound:1,eligibleCells:1,trialCapacity:1,gateCount:1})));
  expect(many.unscheduled.at(-1)?.reason).toBe('LAYOUT_COMPONENT_LIMIT');expect(many.allocations).toHaveLength(128);
});
