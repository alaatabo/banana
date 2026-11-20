import { createGame, act, RuleError } from '../src/engine.js';
import { randomAction, whoActs } from './random-agent.js';
const mode = process.argv[2], n = +process.argv[3];
const counts = {}; let rej = {}, steps=0;
for (let seed=1; seed<=200; seed++){
  const players = Array.from({length:n},(_,i)=>({id:'p'+i,name:'P'+i}));
  const st = createGame({mode, players, seed});
  let r = seed; const rnd=()=>{r=(r*1103515245+12345)%2147483648; return r/2147483648;};
  let last=0;
  while(!st.over){
    steps++;
    for (const e of st.events) if (e.seq>last){ const k=e.type+(e.card?':'+e.card:'')+(e.option?':'+e.option:'')+(e.ok!==undefined?':'+e.ok:''); counts[k]=(counts[k]||0)+1; }
    last=st.seq;
    const who=whoActs(st); const pid=who[Math.floor(rnd()*who.length)];
    const a=randomAction(st,pid,rnd);
    try{act(st,pid,a);}catch(e){ if(!(e instanceof RuleError)) throw e; rej[e.message]=(rej[e.message]||0)+1;}
  }
}
console.log(mode,n,'steps',steps); console.log(Object.entries(counts).sort().map(([k,v])=>k+'='+v).join('  ')); console.log('rejected',rej);
