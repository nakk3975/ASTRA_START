import json,math
from pathlib import Path
from collections import defaultdict
D=Path(__file__).resolve().parent
c=json.loads((D/'balance_v1.json').read_text(encoding='utf-8'));base=json.loads((D/'factory_schedule_analysis.json').read_text(encoding='utf-8'));bom=json.loads((D/'balance_analysis.json').read_text(encoding='utf-8'))
R=c['recipes'];I=c['items'];S=c['sources'];prod={next(iter(r['output'])):rid for rid,r in R.items()}
order=[];seen=set()
def visit(i):
 if i in seen:return
 seen.add(i)
 if i in prod:
  for j in R[prod[i]]['input']:visit(j)
 order.append(i)
for i in I:visit(i)
def expand(req):
 need=defaultdict(int,req);batches={}
 for i in reversed(order):
  if i not in prod:continue
  rid=prod[i];r=R[rid];out=r['output'][i];b=(need[i]+out-1)//out;batches[rid]=b
  for j,v in r['input'].items():need[j]+=b*v
 return {'raw':{i:need[i] for i in S},'batches':batches}
def worker(raw):
 a=c['analysis_assumptions']['baseline_haul'];total=0
 for i,q in raw.items():
  s=S[i];total+=math.ceil(q/s['manual_yield'])*s['manual_action_ticks']*.05
  if q:total+=math.ceil(q/a['batch_units'])*(2*a['one_way_distance_tiles']/a['speed_tiles_per_second']+a['total_transfer_seconds_per_round_trip'])
 return total/60
def rate(i):
 a=c['analysis_assumptions']['baseline_haul'];s=S[i];batch=a['batch_units']
 return batch*60/(math.ceil(batch/s['manual_yield'])*s['manual_action_ticks']*.05+2*a['one_way_distance_tiles']/a['speed_tiles_per_second']+a['total_transfer_seconds_per_round_trip'])
results=[]
for n in range(1,7):
 old=base['results'][n-1];orig=bom['scenarios'][n-1];extractors=c['analysis_assumptions']['extractor_assignments'][str(n)];count=sum(extractors.values());layout=c['analysis_assumptions']['reference_layouts'][str(n)]
 new_demand=orig['peak_demand_power']+2*count
 solar_add=max(0,math.ceil((new_demand-orig['peak_supply_power'])/8))
 upcost=defaultdict(int)
 for item,q in c['upgrades']['extractor_mk2']['cost'].items():upcost[item]+=q*count
 for item,q in c['machines']['solar_array']['paid_cost'].items():upcost[item]+=q*solar_add
 expanded=expand(upcost);new_auto={i:v*2 for i,v in old['auto_raw_supply_per_minute'].items()};new_gap={i:max(0,old['peak_raw_demand_per_minute'][i]-new_auto[i]) for i in S}
 pe=sum(v/rate(i) for i,v in new_gap.items());saved=old['total_continuous_player_equivalents_baseline']-pe
 work=defaultdict(float)
 for rid,b in expanded['batches'].items():work[R[rid]['machine']]+=b*R[rid]['duration_ticks']*.05/60
 proc=c['analysis_assumptions']['processor_assignments'][str(n)]
 lower=max([expanded['batches'][prod[i]]*R[prod[i]]['duration_ticks']*.05/60/proc[i] for i in proc]+[work[t]/layout[t] for t in ['fabricator','refinery','assembler']])
 # Select only sufficient upgrades to remove a deficit, bounded by existing pads.
 selective={i:min(extractors[i],math.ceil(old['manual_topup_per_minute_to_sustain_peak'][i]/(S[i]['extractor_yield']*1200/S[i]['extractor_cycle_ticks']))) for i in S}
 sc=sum(selective.values());sd=orig['peak_demand_power']+sc*2;ss=max(0,math.ceil((sd-orig['peak_supply_power'])/8))
 selective_cost=expand({'plate':sc*6+ss*8,'gear':sc*8,'circuit':sc*2,'wire':ss*8})
 remaining_goals=defaultdict(int)
 for m in ['M5','M6']:
  for i,q in orig['scaled_milestones'][m].items():remaining_goals[i]+=q
 remaining=expand(remaining_goals)['raw']
 result={'planned_players':n,'extractors_upgraded':count,'all_upgraded_power_demand':new_demand,'minimum_extra_solar':solar_add,'total_solar_after_minimum_addition':layout['solar_array']+solar_add,'power_supply_after_minimum_addition':orig['peak_supply_power']+solar_add*8,'additional_raw_cost_all_upgrade_and_minimum_solar':expanded['raw'],'additional_crafting_capacity_lower_bound_minutes':lower,'baseline_manual_work_equivalent_of_additional_cost_minutes':worker(expanded['raw']),'automatic_supply_after_upgrade_per_minute':new_auto,'manual_topup_after_upgrade_per_minute':new_gap,'manual_player_equivalents_after_upgrade':pe,'manual_player_equivalents_saved_at_continuous_peak':saved,'manual_work_equivalence_payback_elapsed_minutes':worker(expanded['raw'])/saved if saved else None,'selective_upgrades':selective,'selective_upgrade_count':sc,'selective_minimum_extra_solar':ss,'selective_additional_raw_cost':selective_cost['raw'],'remaining_rocket_raw_after_M4':remaining,'all_upgrade_metal_cost_divided_by_remaining_rocket_metal':expanded['raw']['metal_scrap']/remaining['metal_scrap']}
 assert max(new_auto[i]/extractors[i] for i in S)<30
 assert result['total_solar_after_minimum_addition']<=12
 assert result['power_supply_after_minimum_addition']>=new_demand
 results.append(result)
 print(n,'upgrades',count,'extra solar',solar_add,'power',new_demand,result['power_supply_after_minimum_addition'],'cost',expanded['raw'],'lower',round(lower,2),'equiv ROI',round(result['manual_work_equivalence_payback_elapsed_minutes'],2),'selective',sc,selective_cost['raw'])
report={'proposal_only':False,'upgrade_defined_in_balance_config':True,'upgrade_id':'extractor_mk2','unlock':'M4','cost':c['upgrades']['extractor_mk2']['cost'],'work_rate_multiplier':{'numerator':2,'denominator':1},'power_multiplier':{'numerator':2,'denominator':1},'eligibility':'extractor tier1 only, once per instance','refund':'exact paid upgrade ledger, root empty-idle field crate policy','no_cycle':True,'source_link_fits_30_per_minute':True,'analysis_limitations':['payback is value in avoided manual gathering/hauling under simultaneous sustained maximum demand, not a financial ROI or measured elapsed gameplay benefit','manufacturing lower bound excludes recipe unlock and input shortage, walking, builds and delivery','late unlock means inspect remaining demand; upgrading everything can be slower than finishing the rocket','reference factory from base file is unchanged'],'results':results,'six_player_three_extra_solar_case':{'total_solar':11,'supply_power':94,'demand_power':83,'spare_power':11,'additional_raw_cost':{'metal_scrap':384,'cable_scrap':30,'plastic_scrap':36,'energy_shard':0}},'six_player_all_processing_and_all_extractors_MK2':{'power_demand':105.5,'max_solar_12_plus_starter_supply':102,'power_ratio':102/105.5,'interpretation':'cannot claim simultaneous 100 percent speed for every upgraded machine at the solar cap'}}
(D/'extractor_mk2_analysis.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
