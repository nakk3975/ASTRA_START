import json, math
from pathlib import Path
from collections import defaultdict
from fractions import Fraction
D=Path(__file__).resolve().parent
c=json.loads((D/'balance_v1.json').read_text(encoding='utf-8'))
recipes=c['recipes']; items=c['items']; sources=c['sources']; producers={}
for rid,r in recipes.items():
 for i in r['output']:
  assert i not in producers,(i,'multiple producers')
  producers[i]=rid
seen=set();stack=set();order=[]
def visit(i):
 if i in seen:return
 assert i not in stack,(i,'cycle')
 stack.add(i)
 if i in producers:
  for p in recipes[producers[i]]['input']:visit(p)
 else:assert i in sources,(i,'missing source')
 stack.remove(i);seen.add(i);order.append(i)
for i in items:visit(i)

def expand(req):
 need=defaultdict(int,req);batches={};surplus={}
 for i in reversed(order):
  if i not in producers:continue
  r=recipes[producers[i]]; q=need[i];out=r['output'][i]
  count=(q+out-1)//out;batches[producers[i]]=count
  surplus[i]=count*out-q
  for p,n in r['input'].items():need[p]+=n*count
 return {'raw':{i:need[i] for i in sources},'recipe_batches':batches,'surplus':{i:n for i,n in surplus.items() if n},'expanded_requirements':dict(need)}

def goals(n):
 s=c['planned_players']['scales'][str(n)];nu=s['numerator'];de=s['denominator']
 a={m['id']:{i:(q*nu+de-1)//de for i,q in m['base_targets'].items()} for m in c['milestones']}
 combined=defaultdict(int)
 for t in a.values():
  for i,q in t.items():combined[i]+=q
 return a,dict(combined)

def gather_worker_minutes(raw,mode):
 a=c['analysis_assumptions'][mode+'_haul'];secs=0
 for i,q in raw.items():
  src=sources[i]
  secs+=math.ceil(q/src['manual_yield'])*src['manual_action_ticks']*c['tick_ms']/1000
  if q:
   trips=math.ceil(q/a['batch_units'])
   secs+=trips*(2*a['one_way_distance_tiles']/a['speed_tiles_per_second']+a['total_transfer_seconds_per_round_trip'])
 return secs/60
results=[]
for n in range(1,7):
 st,g=goals(n);pure=expand(g);layout=c['analysis_assumptions']['reference_layouts'][str(n)]
 all_cost=defaultdict(int,g)
 for mid,count in layout.items():
  cost=c['delivery']['paid_cost_per_link'] if mid=='delivery_link' else c['machines'][mid]['paid_cost']
  for i,v in cost.items():all_cost[i]+=v*count
 full=expand(all_cost)
 work=defaultdict(float)
 for rid,b in full['recipe_batches'].items():work[recipes[rid]['machine']]+=b*recipes[rid]['duration_ticks']*c['tick_ms']/60000
 pc=c['analysis_assumptions']['processor_assignments'][str(n)]
 processor_by_item={i:full['recipe_batches'][producers[i]]*recipes[producers[i]]['duration_ticks']*c['tick_ms']/60000/pc[i] for i in pc}
 production=max(list(processor_by_item.values())+[work[m]/layout[m] for m in ['fabricator','refinery','assembler']])
 supply=c['power']['starter_supply_deci_units']+layout['solar_array']*c['machines']['solar_array']['supply_deci_units']
 demand=sum(c['machines'][m]['power_deci_units']*count for m,count in layout.items() if m!='delivery_link')
 assert supply>=demand,(n,'power budget')
 assert sum(pc.values())==layout['processor']
 ea=c['analysis_assumptions']['extractor_assignments'][str(n)]
 assert sum(ea.values())==layout['extractor']
 assert all(v<=sources[i]['extractor_pads'] for i,v in ea.items())
 raw_cap={i:full['raw'][i]/(ea[i]*sources[i]['extractor_yield']*1200/sources[i]['extractor_cycle_ticks']) for i in sources}
 results.append({'planned_players':n,'scaled_milestones':st,'direct_goals':g,'rocket_only':pure,'reference_factory':full,'reference_counts':layout,'peak_supply_power':supply/10,'peak_demand_power':demand/10,'processor_work_minutes_per_assigned_machine':processor_by_item,'production_capacity_lower_bound_minutes':production,'adverse_production_capacity_lower_bound_minutes':production/(.8*.75),'all_manual_acquisition_worker_minutes_baseline':gather_worker_minutes(full['raw'],'baseline'),'all_manual_acquisition_worker_minutes_adverse':gather_worker_minutes(full['raw'],'adverse'),'all_manual_acquisition_team_minutes_baseline':gather_worker_minutes(full['raw'],'baseline')/n,'all_manual_acquisition_team_minutes_adverse':gather_worker_minutes(full['raw'],'adverse')/n,'hypothetical_all_extractors_from_start_raw_capacity_minutes':raw_cap})
# Progression reachability independent of paid machines, power, and other players.
complete={'START'};available=set();reach=[]
for m in c['milestones']:
 def closure():
  available.update(i for i,s in sources.items() if s['unlock'] in complete)
  change=True
  while change:
   change=False
   for rid,r in recipes.items():
    if r['unlock'] in complete and set(r['input'])<=available:
     before=len(available);available.update(r['output']);change |= len(available)>before
 closure()
 assert set(m['base_targets'])<=available,(m['id'],'locked mandatory material')
 assert set(m['requires_completed'])<=complete
 reach.append({'milestone':m['id'],'available_before_completion':sorted(available),'mandatory_targets_reachable':True})
 complete.add(m['id']);closure()
 for mid,v in c['machines'].items():
  if v['unlock'] in complete:assert set(v['paid_cost'])<=available,(mid,'locked machine cost')
for n in range(1,7):
 assert all(q>0 for d in goals(n)[0].values() for q in d.values())
for rid,r in recipes.items():
 assert r['duration_ticks']>0 and isinstance(r['duration_ticks'],int)
 assert all(isinstance(v,int) and v>0 for v in [*r['input'].values(),*r['output'].values()])
 assert set(r['input'])|set(r['output'])<=set(items)
 assert r['manual_allowed']
 assert r['duration_ticks']*3%2==0
# Bootstrap baseline exact materials for M1 + first processor.
boot=dict(goals(1)[0]['M1'])
for i,q in c['machines']['processor']['paid_cost'].items():boot[i]=boot.get(i,0)+q
bo=expand(boot)
manual_work=sum(b*recipes[r]['duration_ticks']*c['tick_ms']/1000*1.5 for r,b in bo['recipe_batches'].items())
boot_result={'raw':bo['raw'],'manual_craft_seconds':manual_work,'baseline_gather_seconds_including_haul':gather_worker_minutes(bo['raw'],'baseline')*60,'construct_and_transfer_allowance_seconds':60,'total_illustrative_seconds':manual_work+gather_worker_minutes(bo['raw'],'baseline')*60+60}
output={'version':c['balance_version'],'checks':{'recipe_DAG_acyclic':True,'unique_item_producer':True,'all_milestones_manual_reachable':True,'all_machine_costs_reachable_at_unlock':True,'all_reference_peak_power_sufficient':True,'all_source_pad_caps_valid':True,'all_six_scalings_positive_integer':True,'all_recipe_ticks_integer_and_manual_ratio_exact':True},'reachability':reach,'bootstrap_solo':boot_result,'scenarios':results,'limitations':c['analysis_assumptions']['production_lower_bound_excludes']}
(D/'balance_analysis.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
print('CHECKS',output['checks'])
print('Bootstrap',boot_result)
for r in results:
 print(r['planned_players'],'rocket',r['rocket_only']['raw'],'with factory',r['reference_factory']['raw'],'power',r['peak_demand_power'],r['peak_supply_power'],'production LB',round(r['production_capacity_lower_bound_minutes'],2),'adverse LB',round(r['adverse_production_capacity_lower_bound_minutes'],2),'gather team',round(r['all_manual_acquisition_team_minutes_baseline'],2),round(r['all_manual_acquisition_team_minutes_adverse'],2))
