"""Finite recipe scheduler. NOT a game, unlock-order or transport simulation.
All raw materials are available from t=0. All reference machines already exist.
The bill deliberately includes one rocket and the material cost of those machines.
This is a capacity experiment, not a feasible bootstrap playthrough.
"""
import json, math, heapq
from pathlib import Path
from collections import defaultdict
D=Path(__file__).resolve().parent
c=json.loads((D/'balance_v1.json').read_text(encoding='utf-8'));a=json.loads((D/'balance_analysis.json').read_text(encoding='utf-8'))
R=c['recipes'];S=c['sources'];source_ids=set(S);type_recipes=defaultdict(list)
for rid,r in R.items():type_recipes[r['machine']].append(rid)
by_output={next(iter(r['output'])):rid for rid,r in R.items()}

def make_machines(n):
 layout=c['analysis_assumptions']['reference_layouts'][str(n)]
 machines=[]
 for item,count in c['analysis_assumptions']['processor_assignments'][str(n)].items():
  for k in range(count):machines.append({'id':f'{item}_{k}','type':'processor','recipes':[by_output[item]],'busy':False})
 for typ in ['fabricator','refinery','assembler']:
  for k in range(layout[typ]):machines.append({'id':f'{typ}_{k}','type':typ,'recipes':type_recipes[typ][:],'busy':False})
 return machines

def run(n,cap):
 record=a['scenarios'][n-1]; target=record['reference_factory'];goals=record['direct_goals'].copy()
 # Add investment item costs to final bill. Machines already exist in this experiment.
 layout=record['reference_counts']
 for mid,count in layout.items():
  cost=c['delivery']['paid_cost_per_link'] if mid=='delivery_link' else c['machines'][mid]['paid_cost']
  for i,q in cost.items():goals[i]=goals.get(i,0)+q*count
 inv=defaultdict(int);reserved=defaultdict(int);goal_reserved=defaultdict(int);delivered=defaultdict(int);raw_consumed=defaultdict(int)
 remaining=target['recipe_batches'].copy();machines=make_machines(n);cursor=defaultdict(int);events=[];t=0;eventseq=0;starts=0;completed=0;max_inv=defaultdict(int);machine_work=defaultdict(int)
 def eligible(rid):
  if remaining[rid]<=0:return False
  r=R[rid]
  if any(i not in source_ids and inv[i]<q for i,q in r['input'].items()):return False
  oi,oq=next(iter(r['output'].items()))
  to_goal=min(oq,max(0,goals.get(oi,0)-delivered[oi]-goal_reserved[oi]))
  to_store=oq-to_goal
  return cap is None or inv[oi]+reserved[oi]+to_store<=cap
 while True:
  # Complete the entire timestamp before taking any new recipe starts.
  while events and events[0][0]==t:
   _,_,mi,rid,to_goal,to_store=heapq.heappop(events);m=machines[mi];r=R[rid];oi,oq=next(iter(r['output'].items()))
   goal_reserved[oi]-=to_goal;reserved[oi]-=to_store;delivered[oi]+=to_goal;inv[oi]+=to_store
   assert goal_reserved[oi]>=0 and reserved[oi]>=0 and inv[oi]>=0
   if cap is not None:assert inv[oi]+reserved[oi]<=cap
   max_inv[oi]=max(max_inv[oi],inv[oi]);m['busy']=False;completed+=1
  for mi,m in enumerate(machines):
   if m['busy']:continue
   choices=m['recipes'];offset=cursor[m['type']]%len(choices)
   ordered=choices[offset:]+choices[:offset]
   chosen=next((rid for rid in ordered if eligible(rid)),None)
   if chosen is None:continue
   r=R[chosen];oi,oq=next(iter(r['output'].items()))
   to_goal=min(oq,max(0,goals.get(oi,0)-delivered[oi]-goal_reserved[oi]));to_store=oq-to_goal
   for i,q in r['input'].items():
    if i in source_ids:raw_consumed[i]+=q
    else:
     inv[i]-=q;assert inv[i]>=0
   goal_reserved[oi]+=to_goal;reserved[oi]+=to_store
   remaining[chosen]-=1;m['busy']=True;eventseq+=1;starts+=1
   machine_work[m['id']]+=r['duration_ticks']
   heapq.heappush(events,(t+r['duration_ticks'],eventseq,mi,chosen,to_goal,to_store))
   cursor[m['type']]=choices.index(chosen)+1
  if not events:
   assert not any(remaining.values()),('deadlocked',n,cap,{r:v for r,v in remaining.items() if v},dict(inv))
   break
  t=events[0][0]
 assert starts==completed==sum(target['recipe_batches'].values())
 assert all(delivered[i]==v for i,v in goals.items())
 assert all(v==0 for v in goal_reserved.values()) and all(v==0 for v in reserved.values())
 assert dict(raw_consumed)==target['raw'],(raw_consumed,target['raw'])
 return {'planned_players':n,'shared_intermediate_item_capacity':cap,'elapsed_ticks':t,'elapsed_minutes':t*c['tick_ms']/60000,'job_count':completed,'final_bill_satisfied':True,'recipe_dependency_and_nonnegative_inventory_passed':True,'raw_consumption_equals_BOM':True,'leftover_products':{i:q for i,q in inv.items() if q},'maximum_stored_intermediate_per_item':dict(max_inv),'machine_utilization':{i:round(v/t,4) for i,v in machine_work.items()}}

def manual_rate(i,mode):
 p=c['analysis_assumptions'][mode+'_haul'];s=S[i];batch=p['batch_units']
 seconds=math.ceil(batch/s['manual_yield'])*s['manual_action_ticks']*.05+2*p['one_way_distance_tiles']/p['speed_tiles_per_second']+p['total_transfer_seconds_per_round_trip']
 return batch*60/seconds

results=[]
for n in range(1,7):
 pa=c['analysis_assumptions']['processor_assignments'][str(n)];ea=c['analysis_assumptions']['extractor_assignments'][str(n)];layout=c['analysis_assumptions']['reference_layouts'][str(n)]
 demand={
  'metal_scrap':pa['ingot']*R['smelt_ingot']['input']['metal_scrap']*1200/R['smelt_ingot']['duration_ticks'],
  'cable_scrap':pa['wire']*R['draw_wire']['input']['cable_scrap']*1200/R['draw_wire']['duration_ticks'],
  'plastic_scrap':pa['polymer']*R['recycle_polymer']['input']['plastic_scrap']*1200/R['recycle_polymer']['duration_ticks'],
  'energy_shard':layout['refinery']*R['blend_fuel']['input']['energy_shard']*1200/R['blend_fuel']['duration_ticks'],
 }
 auto={i:ea[i]*s['extractor_yield']*1200/s['extractor_cycle_ticks'] for i,s in S.items()}
 gap={i:max(0,demand[i]-auto[i]) for i in S}
 baseline={i:gap[i]/manual_rate(i,'baseline') for i in S};adverse={i:gap[i]/manual_rate(i,'adverse') for i in S}
 result={'planned_players':n,'unlimited_shared_storage_schedule':run(n,None),'shared_capacity_200_schedule':run(n,200),'shared_capacity_20_stress_schedule':run(n,20),'peak_raw_demand_per_minute':demand,'auto_raw_supply_per_minute':auto,'manual_topup_per_minute_to_sustain_peak':gap,'continuous_player_equivalents_baseline':baseline,'continuous_player_equivalents_adverse_haul':adverse,'total_continuous_player_equivalents_baseline':sum(baseline.values()),'total_continuous_player_equivalents_adverse_haul':sum(adverse.values())}
 results.append(result)
 print(n,'schedule',round(result['unlimited_shared_storage_schedule']['elapsed_minutes'],2),'cap200',round(result['shared_capacity_200_schedule']['elapsed_minutes'],2),'topup',gap,'player_equiv',round(sum(baseline.values()),3),round(sum(adverse.values()),3))
report={'simulation_scope':'Discrete-event manufacturing schedule with all raw materials, recipes and listed machines available at t=0, no walking, unlock sequencing, purchases, network, delivery transit, player work, construction or investment timing. Direct final bill is reserved first, and intermediate jobs are fair round-robin by machine category. Not an optimized schedule or complete gameplay simulation.','versions':{'balance':c['balance_version']},'buffer_scope':'capacity200 applies only to shared intermediate inventory and its pending output reservations; no per-machine buffers or network routes are simulated. Final-bill deliveries have a separate sink.','source_scope':'Peak topup is instantaneous simultaneous full-factory demand, not session-long average; players can prebuffer, stagger, add extractors, accept slower production, or alter lines. Automatic source clocks are not part of the manufacturing experiment.','results':results}
(D/'factory_schedule_analysis.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
