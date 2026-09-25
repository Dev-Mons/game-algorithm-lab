import { address, resetVelocityCounters, velocityRange, positionRange, constraintCount, energyDampedContacts } from './contact-kernel';
export * from './contact-kernel';

@external('env','clockNow')
declare function clockNow():f64;

/** Per-color rendezvous. Only body-disjoint ranges run concurrently. A failed
 * participant sets STOP; every waiter exits and the host discards this memory. */
function barrier(participants:i32):bool {
  const control=address(30),count=control+64,sense=control+68,stop=control+8;
  if(atomic.load<i32>(stop)!=0)return false;
  const before=atomic.load<i32>(sense);
  if(atomic.add<i32>(count,1)==participants-1) {
    atomic.store<i32>(count,0);atomic.store<i32>(sense,before+1);return true;
  }
  const deadline=clockNow()+1000;let polls:i32=0;
  while(atomic.load<i32>(sense)==before) {
    if(atomic.load<i32>(stop)!=0)return false;
    if((++polls&1023)==0&&clockNow()>deadline){atomic.store<i32>(stop,1);return false;}
  }
  return atomic.load<i32>(stop)==0;
}

export function parallelVelocity(groups:i32,dt:f64,friction:f64,motorSquared:f64,worker:i32,participants:i32):i32 {
  const starts=address(33);resetVelocityCounters();let maximum:f64=0;
  for(let group:i32=0;group<groups;group++) {
    const begin=load<i32>(starts+(<usize>group<<2)),end=load<i32>(starts+(<usize>(group+1)<<2));
    if(begin==end)continue;
    const size=(end-begin+participants-1)/participants,first=begin+worker*size,last=end<first+size?end:first+size;
    maximum=Math.max(maximum,velocityRange(first,last,1,dt,friction,motorSquared));
    if(!barrier(participants))return 0;
  }
  const result=address(31)+(<usize>worker<<5);
  store<f64>(result,maximum);store<f64>(result+8,<f64>constraintCount());store<f64>(result+16,<f64>energyDampedContacts());
  return barrier(participants)?1:0;
}

export function parallelPosition(groups:i32,gap:f64,minimumRadius:f64,worker:i32,participants:i32):i32 {
  const starts=address(29),deferred=address(32);
  for(let group:i32=0;group<groups;group++) {
    const begin=load<i32>(starts+(<usize>group<<2)),end=load<i32>(starts+(<usize>(group+1)<<2));
    const size=(end-begin+participants-1)/participants,first=begin+worker*size,last=end<first+size?end:first+size;
    positionRange(first,last,1,gap,minimumRadius);
    if(!barrier(participants))return 0;
    // Geometry callbacks belong to the main instance. They only read/write the
    // two endpoints; all other pairs in this color have disjoint endpoints.
    if(worker==0)for(let pair=begin;pair<end;pair++)if(load<i8>(deferred+<usize>pair)!=0) {
      positionRange(pair,pair+1,1,gap,minimumRadius);store<i8>(deferred+<usize>pair,0);
    }
    if(!barrier(participants))return 0;
  }
  return 1;
}
