#!/usr/bin/env python3
"""Validate the design data. This does not test a running multiplayer game.

Usage: python validate_balance.py [--config balance_v1.json] [--out validation_results.json]
Requires Python 3.10+ and only the standard library.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import defaultdict
from fractions import Fraction
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path(__file__).with_name('balance_v1.json'))
    parser.add_argument('--out', type=Path, default=Path(__file__).with_name('validation_results.json'))
    args = parser.parse_args()
    c = json.loads(args.config.read_text(encoding='utf-8'))
    records: list[dict] = []

    def check(key: str, condition: bool, detail: str) -> None:
        records.append({'id': key, 'passed': bool(condition), 'detail': detail})

    def positive_int(value) -> bool:
        return type(value) is int and value > 0

    recipes, sources, items, machines = (c[k] for k in ('recipes', 'sources', 'items', 'machines'))
    mids = [m['id'] for m in c['milestones']]
    stage_rank = {'START': 0, **{mid: i + 1 for i, mid in enumerate(mids)}}
    check('C01_COUNTS', len(items) == 14 and len(recipes) == 10 and len(mids) == 6,
          '14 items, 10 recipes, 6 sequential milestones')
    check('C02_PARTY', c['planned_players']['minimum'] == 1 and c['planned_players']['maximum'] == 6
          and set(c['planned_players']['scales']) == {str(i) for i in range(1, 7)}
          and c['machines']['manual_workbench']['player_slots'] == 6
          and all(s['manual_slots'] == 6 for s in sources.values()),
          'All party limits and manual concurrency support 1 through 6')
    check('C03_SCALING_SCOPE', c['planned_players']['locked_at_game_start'] is True
          and c['planned_players']['lobby_changes_allowed'] is True
          and c['planned_players']['scale_applies_to'] == ['milestone.base_targets'],
          'Only construction targets scale and the selected scale locks at game start')
    producer = {}
    duplicate = []
    for rid, r in recipes.items():
        for item in r['output']:
            if item in producer:
                duplicate.append(item)
            producer[item] = rid
    check('C04_PRODUCERS', not duplicate and set(producer) | set(sources) == set(items)
          and not set(producer) & set(sources),
          'Every manufactured item has one producer and every other item has a source')
    errors = []
    for rid, r in recipes.items():
        if not (positive_int(r['duration_ticks']) and r['machine'] in machines
                and r['unlock'] in stage_rank and r['manual_allowed']
                and len(r['output']) == 1):
            errors.append(rid)
        for side in ('input', 'output'):
            if any(i not in items or not positive_int(q) for i, q in r[side].items()):
                errors.append(rid + ':' + side)
    check('C05_RECIPE_SCHEMA', not errors, 'Valid recipe IDs, positive integer quantities and times: ' + str(errors))
    if duplicate or errors:
        args.out.write_text(json.dumps({'checks': records, 'passed': False}, ensure_ascii=False, indent=2), encoding='utf-8')
        return 1

    visited, active, order = set(), set(), []
    def visit(item):
        if item in active:
            raise ValueError('Dependency cycle at ' + item)
        if item in visited:
            return
        active.add(item)
        if item in producer:
            for parent in recipes[producer[item]]['input']:
                visit(parent)
        elif item not in sources:
            raise ValueError('Unproducible item ' + item)
        active.remove(item)
        visited.add(item)
        order.append(item)
    try:
        for item in items:
            visit(item)
        dag_ok = True
    except ValueError as e:
        dag_ok = False
        errors.append(str(e))
    check('C06_ACYCLIC', dag_ok, 'The full item graph is a DAG: ' + str(errors))
    if not dag_ok:
        args.out.write_text(json.dumps({'checks': records, 'passed': False}, ensure_ascii=False, indent=2), encoding='utf-8')
        return 1

    def expand(demand):
        quantities = defaultdict(int, demand)
        batches = {}
        surplus = {}
        for item in reversed(order):
            if item not in producer:
                continue
            rid = producer[item]
            recipe = recipes[rid]
            out = recipe['output'][item]
            count = (quantities[item] + out - 1) // out
            batches[rid] = count
            surplus[item] = count * out - quantities[item]
            for resource, amount in recipe['input'].items():
                quantities[resource] += amount * count
        return {'raw': {i: quantities[i] for i in sources}, 'batches': batches,
                'surplus': {i: q for i, q in surplus.items() if q}, 'expanded': dict(quantities)}

    def unit_raw(item):
        if item in sources:
            return {item: Fraction(1)}
        recipe = recipes[producer[item]]
        result = defaultdict(Fraction)
        for resource, amount in recipe['input'].items():
            for raw, cost in unit_raw(resource).items():
                result[raw] += cost * amount / recipe['output'][item]
        return dict(result)

    # Reachability is checked before completing each milestone, not afterward.
    available = set()
    completed = {'START'}
    reachability = []
    def close_available():
        available.update(i for i, s in sources.items() if s['unlock'] in completed)
        while True:
            old = set(available)
            for r in recipes.values():
                if r['unlock'] in completed and set(r['input']) <= available:
                    available.update(r['output'])
            if available == old:
                break
    for m in c['milestones']:
        close_available()
        reachability.append(set(m['base_targets']) <= available and set(m['requires_completed']) <= completed)
        completed.add(m['id'])
    check('C07_MILESTONE_REACHABLE', all(reachability), 'Every milestone is manually reachable before its own unlock')
    def earliest(item):
        if item in sources:
            return stage_rank[sources[item]['unlock']]
        r = recipes[producer[item]]
        return max(stage_rank[r['unlock']], *(earliest(i) for i in r['input']))
    cost_errors = []
    for mid, machine in machines.items():
        for item, q in machine['paid_cost'].items():
            if item not in items or not positive_int(q) or earliest(item) > stage_rank[machine['unlock']]:
                cost_errors.append(mid + ':' + item)
    for uid, upgrade in c['upgrades'].items():
        for item, q in upgrade['cost'].items():
            if item not in items or not positive_int(q) or earliest(item) > stage_rank[upgrade['unlock']]:
                cost_errors.append(uid + ':' + item)
        if any(req not in c['upgrades'] for req in upgrade.get('requires', [])):
            cost_errors.append(uid + ':prerequisite')
    check('C08_INVESTMENT_REACHABLE', not cost_errors, 'All machine and upgrade costs are reachable at unlock: ' + str(cost_errors))
    check('C09_BOOTSTRAP', machines['manual_workbench']['power_deci_units'] == 0
          and machines['manual_workbench']['paid_cost'] == {}
          and machines['manual_workbench']['indestructible']
          and c['power']['starter_supply_deci_units'] > 0
          and all(s['finite'] is False for s in sources.values()),
          'Free protected manual workbench, initial power and unlimited deterministic raw sources')

    throughput_ok = True
    for r in recipes.values():
        for item, q in r['output'].items():
            calculated = Fraction(q * 60000, r['duration_ticks'] * c['tick_ms'])
            stated = Fraction(str(r['output_per_minute_at_full_power'][item]))
            throughput_ok &= calculated == stated
    check('C10_RECIPE_RATES', throughput_ok, 'All displayed full-power output rates recompute exactly')
    slots_ok = all(max(r['input'].values()) <= c['storage']['machine_input_capacity_per_accepted_item']
                   and max(r['output'].values()) <= c['storage']['machine_output_capacity_per_produced_item']
                   for r in recipes.values())
    check('C11_BATCH_CAPACITY', slots_ok, 'Every recipe input and result batch fits the declared per-item buffers')
    delivery = c['delivery']
    travel_ticks = math.ceil(Fraction(delivery['max_distance_tiles'] * 1000,
                                      delivery['travel_speed_tiles_per_second'] * c['tick_ms']))
    min_flights = math.ceil(Fraction(travel_ticks, delivery['base_dispatch_interval_ticks']))
    check('C12_TRANSPORT_CAPACITY', delivery['max_in_transit_per_link'] >= min_flights
          and delivery['reserve_destination_before_dispatch']
          and delivery['in_transit_is_authoritative_inventory'],
          f'Max route takes {travel_ticks} ticks; at least {min_flights} flight slots needed, '
          f'{delivery["max_in_transit_per_link"]} provided')

    known_raw = {1: [980,106,520,200], 2: [1454,159,766,290], 3: [1792,196,948,360],
                 4: [2094,228,1104,420], 5: [2340,254,1234,470], 6: [2584,281,1364,520]}
    scenarios = []
    goal_totals = []
    all_power = all_pads = all_entity_caps = all_assignment = all_bom = True
    all_rational_lower = True
    for n in range(1, 7):
        scale = c['planned_players']['scales'][str(n)]
        num, den = scale['numerator'], scale['denominator']
        stages = {m['id']: {i: (q * num + den - 1) // den for i, q in m['base_targets'].items()}
                  for m in c['milestones']}
        total = defaultdict(int)
        for goal in stages.values():
            for item, q in goal.items():
                total[item] += q
        goal_totals.append(dict(total))
        rocket = expand(total)
        all_bom &= list(rocket['raw'].values()) == known_raw[n]
        rational = defaultdict(Fraction)
        for item, q in total.items():
            for raw, units in unit_raw(item).items():
                rational[raw] += units * q
        all_rational_lower &= all(rocket['raw'][raw] >= cost for raw, cost in rational.items())
        layout = c['analysis_assumptions']['reference_layouts'][str(n)]
        full_demand = defaultdict(int, total)
        for mid, count in layout.items():
            cost = delivery['paid_cost_per_link'] if mid == 'delivery_link' else machines[mid]['paid_cost']
            for item, q in cost.items():
                full_demand[item] += count * q
        factory = expand(full_demand)
        pc = c['analysis_assumptions']['processor_assignments'][str(n)]
        ea = c['analysis_assumptions']['extractor_assignments'][str(n)]
        all_assignment &= sum(pc.values()) == layout['processor'] and sum(ea.values()) == layout['extractor']
        all_pads &= all(count <= sources[i]['extractor_pads'] for i, count in ea.items())
        all_entity_caps &= (sum(v for k, v in layout.items() if k != 'delivery_link')
                            <= c['caps']['total_placed_machine_entities_excluding_starter'])
        all_entity_caps &= layout['solar_array'] <= c['caps']['solar_arrays'] and layout['delivery_link'] <= delivery['max_links']
        supply = c['power']['starter_supply_deci_units'] + layout['solar_array'] * machines['solar_array']['supply_deci_units']
        demand = sum(machines[mid]['power_deci_units'] * count for mid, count in layout.items() if mid != 'delivery_link')
        all_power &= supply >= demand
        load = defaultdict(Fraction)
        for rid, count in factory['batches'].items():
            r = recipes[rid]
            load[r['machine']] += Fraction(count * r['duration_ticks'] * c['tick_ms'], 60000)
        lower_parts = {i: Fraction(factory['batches'][producer[i]] * recipes[producer[i]]['duration_ticks'] * c['tick_ms'],
                                  60000 * count) for i, count in pc.items()}
        lower_parts.update({mid: load[mid] / layout[mid] for mid in ['fabricator', 'refinery', 'assembler']})
        bottleneck_minutes = max(lower_parts.values())
        raw_caps = {raw: Fraction(ea[raw] * sources[raw]['extractor_yield'] * 60000,
                                 sources[raw]['extractor_cycle_ticks'] * c['tick_ms']) for raw in sources}
        auto_only_lb = max(Fraction(factory['raw'][i]) / raw_caps[i] for i in sources)
        scenarios.append({'planned_players': n, 'scale': f'{num}/{den}', 'stages': stages,
                          'rocket_only_raw': rocket['raw'], 'rocket_only_batches': rocket['batches'],
                          'rocket_only_surplus': rocket['surplus'], 'factory_included_raw': factory['raw'],
                          'factory_included_batches': factory['batches'], 'factory_included_surplus': factory['surplus'],
                          'reference_layout': layout, 'power_supply': supply/10, 'power_peak_demand': demand/10,
                          'ideal_processing_capacity_lower_bound_min': round(float(bottleneck_minutes), 3),
                          'adverse_processing_capacity_lower_bound_min': round(float(bottleneck_minutes / Fraction(3,5)), 3),
                          'hypothetical_all_extractors_available_from_start_lower_bound_min': round(float(auto_only_lb), 3),
                          'automatic_raw_supply_per_min': {i: float(v) for i,v in raw_caps.items()}})
    check('C13_INDEPENDENT_BOM', all_bom and all_rational_lower,
          'Integer batch expansion matches independently recorded six-player-count BOM and rational lower costs')
    check('C14_MONOTONIC_COST', all(all(goal_totals[i][k] <= goal_totals[i+1][k]
                                    for k in goal_totals[i]) for i in range(5)),
          'Increasing planned player count never reduces a construction target total')
    check('C15_REFERENCE_POWER', all_power, 'Each reference layout has enough supply for every eligible MK1 machine')
    check('C16_REFERENCE_SOURCE_PADS', all_pads and all_assignment, 'Reference source pads and processor assignments match machine counts')
    check('C17_REFERENCE_ENTITY_CAPS', all_entity_caps, 'All reference layouts fit entity, solar and delivery link count caps')
    check('C18_ASSEMBLY', set(c['construction']['assembly_base_ticks']) == set(mids)
          and all(positive_int(v) for v in c['construction']['assembly_base_ticks'].values())
          and set(c['construction']['assembly_rate_by_contributors']) == {str(i) for i in range(1,7)},
          'Assembly duration and participant multipliers cover all six stages and counts')
    fp = c['power']['progress_fixed_point_scale']
    ratio_samples = [(60,0,fp), (60,60,fp), (60,120,fp//2), (60,61,9836)]
    fp_ok = all((fp if demand == 0 else min(fp, supply*fp//demand)) == expected
                for supply, demand, expected in ratio_samples)
    check('C19_FIXED_POINT', fp_ok and c['tick_ms'] == 50 and fp == 10000,
          '20 Hz integer work accumulation covers zero demand and partial-power boundaries')
    check('C20_REFUND_POLICY', 'EMPTY_IDLE' in c['refunds']['machine_and_link_demolition']
          and 'paidCostLedger' in c['refunds']['machine_and_link_demolition']
          and c['storage']['recovery_vault_has_automatic_ports'] is False
          and c['storage']['on_site_recovery_crate_has_automatic_ports'] is False
          and c['storage']['warehouse_manual_overflow_stash_enabled'] is True
          and c['storage']['warehouse_overflow_stash_requires_full_warehouse'] is False,
          'Empty-only exact-cost refund, local manual overflow enabled, no automated recovery logistics')

    # The old aggregate-then-ceil shortcut is specifically rejected.
    scaled_stage_wire = sum(m['base_targets'].get('wire',0)*26 for m in c['milestones'])
    aggregate_rounded_wire = (scaled_stage_wire + 9)//10
    actual_wire = sum(scenarios[5]['stages'][m].get('wire',0) for m in mids)
    check('C21_ROUNDING_REGRESSION', actual_wire == 95 and aggregate_rounded_wire == 94,
          '6-player direct wire goals round per milestone: 11+32+52=95, not ceil(36*2.6)=94')

    canonical = json.dumps(c, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    result = {'balance_version':c['balance_version'], 'canonical_balance_sha256':hashlib.sha256(canonical).hexdigest(),
              'validation_kind':'design_static_accounting_not_runtime_game_tests',
              'passed':all(r['passed'] for r in records), 'check_group_count':len(records),
              'checks':records, 'scenarios':scenarios,
              'limitations':['No actual browser game has been tested.',
                 'Capacity lower bounds omit unlock order, investment timing, travel, UI, finite buffers and route topology.',
                 'Automatic-source bound assumes all listed extractors exist from time zero; this is deliberately optimistic.',
                 'A complete playthrough can only be validated after implementation.']}
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    for record in records:
        print(('PASS' if record['passed'] else 'FAIL') + ' ' + record['id'] + ' ' + record['detail'])
    print('RESULT',result['passed'],'GROUPS',len(records),'SHA256',result['canonical_balance_sha256'])
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
