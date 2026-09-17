import {expect,it} from 'vitest';
import {ReservationBook} from '../src/core/reservations';
import {cellBox16} from '../src/core/placement-bounds';
import type {Reservation} from '../src/core/environment-contract';
const reservation=(id:string,kind:Reservation['kind'],x=0,priority:Reservation['priority']=700):Reservation=>({id,ownerId:id,sourceRefs:[],kind,priority,cells:[[x,0,0]],boxes16:[cellBox16([x,0,0])]});
it('shares walk and landing usage, forbids distinct portals and never grants an owner overlap exemption',()=>{
  const book=new ReservationBook([reservation('walk','walk')]);
  expect(book.tryReserveBatch([reservation('door','entrance')]).accepted).toBe(true);
  expect(book.tryReserveBatch([reservation('door2','entrance')])).toEqual({accepted:false,conflictIds:['door']});
  expect(book.tryReserveBatch([{...reservation('body','fixture'),ownerId:'walk'}]).accepted).toBe(false);
  expect(book.tryReserveBatch([reservation('touch','fixture',1)]).accepted).toBe(true);
});
it('shares vehicle channels but a made-up crossing ID cannot authorize vehicle/walk or vehicle/fixture overlap',()=>{
  const road={...reservation('road','public-vehicle'),crossingId:'fake'},book=new ReservationBook([road]);
  expect(book.tryReserveBatch([reservation('connector','vehicle-aisle')]).accepted).toBe(true);
  expect(book.tryReserveBatch([{...reservation('walk','walk'),crossingId:'fake'}]).accepted).toBe(false);
  expect(book.tryReserveBatch([reservation('body','fixture')]).accepted).toBe(false);
});
it('rejects a conflicting batch atomically and orders accepted proposals independently of input order',()=>{
  const fixed=reservation('fixed','solid',0,1000),book=new ReservationBook([fixed]),before=book.snapshot();
  expect(book.tryReserveBatch([reservation('clear','fixture',2,300),reservation('blocked','fixture',0,300)]).accepted).toBe(false);
  expect(book.snapshot()).toEqual(before);
  const a=new ReservationBook(),b=new ReservationBook(),batch=[reservation('b','fixture',2,300),reservation('a','lighting',0,400)];
  expect(a.tryReserveBatch(batch).accepted).toBe(true);expect(b.tryReserveBatch([...batch].reverse()).accepted).toBe(true);expect(a.snapshot()).toEqual(b.snapshot());
  const snapshot=a.snapshot();snapshot[0].boxes16[0].min[0]=999;expect(a.snapshot()[0].boxes16[0].min[0]).not.toBe(999);
});
