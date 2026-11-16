import {appendFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';import {performance} from 'node:perf_hooks';
import {B,R,canonical} from '../../../packages/content/src/index.ts';
import {command,tick,recover,maintenance,type World,type Runtime} from '../../../packages/game-core/src/index.ts';
import type {Command,Ack} from '../../../packages/protocol/src/index.ts';import {Repository,hash,type Receipt} from './repository.ts';
export function secret(){return randomBytes(R.identity.recovery_secret_bytes).toString('base64url');}
export function roomCode(){const a=R.identity.room_code_alphabet,bytes=randomBytes(R.identity.room_code_length);return [...bytes].map(x=>a[x%a.length]).join('');}
type Task={member?:string;cmd?:Command;mutate?:(w:World)=>unknown;resolve:(x:any)=>void;reject:(e:unknown)=>void};
export class Actor{
 world!:World;epoch='0';rt:Runtime={inputs:{},now:0,wallNow:0};queue:Task[]=[];busy=false;failed:string|null=null;nextTick=performance.now();lastSnapshot=performance.now();lastRenew=0;timer?:ReturnType<typeof setInterval>;onPublish:(w:World)=>void=()=>{};onPending:(code:string)=>void=()=>{};metrics={ticks:[] as number[],commits:[] as number[],deltaBytes:[] as number[]};
 constructor(public repo:Repository,public id:string){}
 async open(){this.epoch=await this.repo.acquire(this.id);this.world=await this.repo.load(this.id);const before=this.world,after=structuredClone(before);recover(after,Date.now());if(canonical(before)!==canonical(after)){after.version=(BigInt(before.version)+1n).toString();await this.repo.commit(before,after,this.epoch,[]);this.world=after;}this.lastRenew=performance.now();this.nextTick=performance.now();this.timer=setInterval(()=>void this.pump(),R.timers_ms.simulation_tick);}
 enqueue(member:string,cmd:Command):Promise<Ack>{if(this.queue.length>=R.limits.command_queue_per_room||this.queue.filter(x=>x.member===member).length>=R.limits.command_queue_per_member)return Promise.reject(Error('SERVER_BUSY'));return new Promise((resolve,reject)=>this.queue.push({member,cmd,resolve,reject}));}
 mutate(fn:(w:World)=>unknown):Promise<any>{return new Promise((resolve,reject)=>this.queue.push({mutate:fn,resolve,reject}));}
 async pump(){
 if(this.busy||!this.world)return;this.busy=true;
 const tasks=this.queue.splice(0,R.limits.command_queue_per_room);const responses:{task:Task;value:unknown}[]=[];
 try{
  const mono=performance.now();if(mono-this.lastRenew>=R.timers_ms.writer_renew_interval){await this.repo.renew(this.id,this.epoch);this.lastRenew=performance.now();}
  if(this.failed){this.world=await this.repo.load(this.id);this.failed=null;this.nextTick=performance.now();this.onPublish(this.world);}
  const before=this.world;let after=structuredClone(before);const receipts:Receipt[]=[];const dedupe=new Map<string,{hash:string;ack:Ack}>();let recoveryHash:string|undefined;this.rt.now=performance.now();this.rt.wallNow=Date.now();
  for(const task of tasks){
   if(task.mutate){const candidate=structuredClone(after);try{const value:any=await task.mutate(candidate);if(value?._recoveryHash){recoveryHash=value._recoveryHash;delete value._recoveryHash;}after=candidate;responses.push({task,value});}catch(e){task.reject(e);}continue;}
   const c=task.cmd!,member=task.member!,fingerprint=hash({type:c.type,payload:c.payload}),key=member+':'+c.commandId;
   const duplicate=dedupe.get(key),prior=duplicate?{payload_hash:duplicate.hash,outcome:duplicate.ack}:await this.repo.receipt(this.id,member,c.commandId);
   if(prior){if(prior.payload_hash!==fingerprint){task.reject(Error('IDEMPOTENCY_KEY_REUSED'));continue;}responses.push({task,value:prior.outcome});continue;}
   const applied=command(after,member,c,this.rt);after=applied.world;
   const ack:Ack={commandId:c.commandId,status:applied.error?'REJECTED':'APPLIED',durableVersion:(BigInt(before.version)+1n).toString(),writerEpoch:this.epoch,appliedTick:after.tick,...(applied.error?{error:{code:applied.error}}:{result:applied.result})};
   let privateKey:string|undefined;
   if(!applied.error){if(c.type==='ROTATE_ROOM_CODE')after.code=roomCode();if(c.type==='ROTATE_RECOVERY_KEY'||applied.result.rotateRecovery){privateKey=secret();recoveryHash=hash(privateKey);}}
   receipts.push({member,payloadHash:fingerprint,ack});dedupe.set(key,{hash:fingerprint,ack});responses.push({task,value:privateKey?{...ack,result:{...ack.result,recoveryKey:privateKey}}:ack});
  }
  const now=performance.now();const active=B.launch.automatic_economy_phases.includes(after.phase)&&!after.pauses.length;
  if(active){if(now-this.nextTick>R.timers_ms.economic_commit_batch_max)this.nextTick=now-R.timers_ms.economic_commit_batch_max+R.timers_ms.simulation_tick;let n=0;while(now>=this.nextTick&&n<B.timing.commit_batch_ticks){const t=performance.now();this.rt.now=this.nextTick;tick(after,this.rt);this.metrics.ticks.push(performance.now()-t);if(this.metrics.ticks.length>2000)this.metrics.ticks.shift();this.nextTick+=R.timers_ms.simulation_tick;n++;}}
  else{this.nextTick=now+R.timers_ms.simulation_tick;maintenance(after,Date.now());}
  if(canonical(before)!==canonical(after)||receipts.length){after.version=(BigInt(before.version)+1n).toString();const t=performance.now();await this.repo.commit(before,after,this.epoch,receipts,{recoveryHash});this.metrics.commits.push(performance.now()-t);if(this.metrics.commits.length>2000)this.metrics.commits.shift();this.world=after;this.onPublish(after);}
  for(const {task,value}of responses)task.resolve(value);
  if(performance.now()-this.lastSnapshot>=R.timers_ms.snapshot_interval){await this.repo.snapshot(this.world);await this.repo.compact(this.id);this.lastSnapshot=performance.now();}
 }catch(e){console.error('ACTOR_FAILURE',this.id,e);if(process.env.NODE_ENV!=='production')appendFileSync('.local/diagnostics.log',String((e as Error)?.stack??e)+'\n');this.failed=(e as Error).message;this.nextTick=performance.now();this.onPending(this.failed);for(const t of tasks)t.reject(Error(this.failed==='WRITER_FENCED'?'WRITER_FENCED':'COMMAND_PENDING'));if(this.failed==='WRITER_FENCED'){clearInterval(this.timer);}}
 finally{this.busy=false;}
 }
 async close(){clearInterval(this.timer);while(this.busy)await new Promise(r=>setTimeout(r,10));if(this.queue.length)await this.pump();await this.repo.snapshot(this.world);await this.repo.release(this.id,this.epoch);}
}
