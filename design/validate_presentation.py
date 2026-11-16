#!/usr/bin/env python3
"""Validate presentation design data with Python 3.10+ standard library only.

No models are generated or downloaded. No browser, GPU, game server or user
comfort test is run. The output is static accounting, not release acceptance.

Usage: python validate_presentation.py
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import itertools
import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parent
EXPECTED_ECONOMY_SHA256 = 'c019a2ce37b4b1025395452972d0beb936a25d4570bcc9a25b39666a424d81b6'
EPS = 1e-9


def canonical_sha256(value: object) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True,
                     separators=(',', ':')).encode('utf-8')
    return hashlib.sha256(raw).hexdigest()


def positive_integer(value: object) -> bool:
    return type(value) is int and value > 0


def close(a: float, b: float) -> bool:
    return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--presentation', type=Path, default=ROOT/'presentation_v1_1.json')
    parser.add_argument('--catalog', type=Path, default=ROOT/'asset_catalog_v1_1.json')
    parser.add_argument('--runtime', type=Path, default=ROOT/'runtime_v1.json')
    parser.add_argument('--balance', type=Path, default=ROOT/'balance_v1.json')
    parser.add_argument('--map', type=Path, default=ROOT/'map_v1.json')
    parser.add_argument('--output', type=Path, default=ROOT/'presentation_validation.json')
    args = parser.parse_args()
    checks: list[dict] = []
    calculated: dict = {}

    def check(cid: str, condition: bool, detail: str) -> None:
        checks.append({'id': cid, 'passed': bool(condition), 'detail': detail})

    try:
        paths = {key: getattr(args, key) for key in ('presentation', 'catalog', 'runtime', 'balance', 'map')}
        data = {key: json.loads(path.read_text(encoding='utf-8')) for key, path in paths.items()}
        p, a, runtime, b, world = (data[k] for k in ('presentation','catalog','runtime','balance','map'))
        assets = a['assets']
        by_id = {asset['id']: asset for asset in assets}

        economy_hash = canonical_sha256(b)
        calculated['canonical_economy_sha256'] = economy_hash
        calculated['input_canonical_sha256'] = {key: canonical_sha256(value) for key,value in data.items()}
        check('P01_ECONOMY_PRESERVED', economy_hash == EXPECTED_ECONOMY_SHA256
              and b['balance_version'] == '1.0.0-design',
              'Economy canonical SHA-256 remains the accepted 1.0 design; presentation does not alter recipes or prices.')
        check('P02_VERSION_LINKS', runtime['protocol_version'] == 2
              and runtime['runtime_version'] == '1.1.0-design'
              and p['presentation_version'] == runtime['presentation_version'] == '1.1.0-design'
              and a['asset_catalog_version'] == runtime['asset_catalog_version'] == '1.1.0-design'
              and runtime['appearance_set_version'] == '1.1.0-design'
              and runtime['renderer_compatibility_version'] == 1
              and runtime['content_version'] == b['balance_version'] == a['economy_balance_version_reference']
              and world['map_version'] == a['map_version_reference'] == '1.0.0',
              'Protocol 2 and presentation/catalog references agree while economic content and map retain their versions.')
        check('P03_SINGLE_RENDERING_SOURCE', runtime['rendering']['presentation_config'] == args.presentation.name
              and runtime['rendering']['asset_catalog'] == args.catalog.name
              and runtime['rendering']['touch_target_css_px'] == 44
              and not any(k in runtime['rendering'] for k in
                          ('desktop_dpr_cap','low_quality_dpr_cap','desktop_target_fps','low_quality_target_fps')),
              'Runtime names the presentation/catalog files and does not duplicate their DPR/FPS settings.')

        projection = p['projection']
        e = math.radians(projection['elevation_from_ground_degrees'])
        az = math.radians(projection['azimuth_degrees_from_positive_x_toward_positive_z'])
        check('P04_FIXED_ORTHOGRAPHIC_CAMERA', projection['type'] == 'OrthographicCamera'
              and projection['elevation_from_ground_degrees'] == 55
              and projection['azimuth_degrees_from_positive_x_toward_positive_z'] == 45
              and projection['roll_degrees'] == 0 and projection['camera_zoom'] == 1
              and p['input']['free_camera_rotation'] is False
              and p['canvas']['dpr_affects_frustum'] is False
              and p['canvas']['panel_resizes_canvas'] is False,
              'Orthographic orientation is fixed; CSS dimensions own framing, independent of DPR and panels.')

        visual = a['visual_size_contract']
        worker_height = visual['worker_height_tiles']
        height_unit = worker_height*math.cos(e)
        framing = []
        for width,height,profile in [(1366,768,'desktop'),(3840,2160,'desktop'),(800,360,'small_landscape')]:
            spans = p['span_height_profiles'][profile]
            framing.append({'css_width':width, 'css_height':height, 'profile':profile,
                            'worker_vertical_css_px':{key:height_unit*height/span for key,span in spans.items()},
                            'default_span_width':spans['default']*width/height})
        calculated['framing'] = framing
        check('P05_FRAMING_AND_CHARACTER_SIZE', close(worker_height,1.8)
              and close(by_id['worker']['bounds_max_tiles']['y'],worker_height)
              and close(p['expected_asset_bounds_for_validation']['worker_height'],worker_height)
              and p['span_height_profiles']['desktop'] == {'near':18,'default':22,'wide':28}
              and p['span_height_profiles']['small_landscape'] == {'near':10,'default':12,'wide':15}
              and all(row['worker_vertical_css_px']['wide'] >= 24 for row in framing),
              'Three CSS reference viewports preserve at least 24px worker vertical height at the widest normal-play zoom.')

        map_width, map_depth = world['dimensions']['width'], world['dimensions']['depth']
        # Corners are projected independently; this also works for non-square maps.
        map_uv = [(x*math.sin(az)-z*math.cos(az),
                   -math.sin(e)*(x*math.cos(az)+z*math.sin(az)))
                  for x,z in itertools.product((0,map_width),(0,map_depth))]
        extent_u = max(q[0] for q in map_uv)-min(q[0] for q in map_uv)
        extent_v = max(q[1] for q in map_uv)-min(q[1] for q in map_uv)
        overview = []
        for row in framing:
            span = max(extent_v, extent_u/(row['css_width']/row['css_height']))*p['overview']['bounds_margin_factor']
            overview.append({'css_width':row['css_width'],'css_height':row['css_height'],
                             'span_height':span,'worker_vertical_css_px':height_unit*row['css_height']/span})
        calculated['map_projection'] = {'ground_projected_width':extent_u,'ground_projected_height':extent_v,
                                        'overview':overview}
        check('P06_OVERVIEW_IS_EXPLICIT', map_width == 48 and map_depth == 32
              and close(p['overview']['bounds_margin_factor'],1.12)
              and p['overview']['explicit_user_action_only'] is True
              and p['overview']['read_only'] is True
              and p['overview']['world_simulation_continues'] is True
              and overview[2]['worker_vertical_css_px'] < 24,
              'Full-map projection is intentionally too small for default interaction and is an explicit read-only view.')

        move_results = []
        for sx,sy in [(1,0),(0,1),(-1,0),(0,-1),(1,1),(-1,1),(1,-1),(-1,-1)]:
            scale = max(1,math.hypot(sx,sy)); ix,iy = sx/scale,sy/scale
            dx = ix*math.sin(az)-iy*math.cos(az)
            dz = -ix*math.cos(az)-iy*math.sin(az)
            projected_right = dx*math.sin(az)-dz*math.cos(az)
            projected_ground_up = -dx*math.cos(az)-dz*math.sin(az)
            move_results.append({'input':[sx,sy],'world_direction':[dx,dz],
                                 'magnitude':math.hypot(dx,dz),
                                 'matches_screen_axes':close(projected_right,ix) and close(projected_ground_up,iy)})
        calculated['movement_directions'] = move_results
        check('P07_SCREEN_MOVEMENT_BASIS', all(row['magnitude']<=1+EPS and row['matches_screen_axes'] for row in move_results),
              'Eight input directions retain their screen axes and never increase normalized movement speed.')

        turns = []
        targets = [(0,-1),(1,0),(0,1),(-1,0)]
        for q in range(4):
            angle = -q*math.pi/2
            # Rotate canonical front (0,0,-1) with Three.js right-handed Y rotation.
            x,z = -math.sin(angle),-math.cos(angle)
            turns.append({'quarter_turns':q,'yaw_radians':angle,'world_front_xz':[x,z],
                          'matches_clockwise_map_front':close(x,targets[q][0]) and close(z,targets[q][1])})
        calculated['quarter_turn_fronts'] = turns
        check('P08_CANONICAL_FRONT_AND_QUARTER_TURNS', a['coordinates']['canonical_forward']=='-Z'
              and a['coordinates']['quarter_turn_y_rotation_radians']=='-quarterTurns*pi/2'
              and all(row['matches_clockwise_map_front'] for row in turns)
              and all(asset['canonical_forward']=='-Z' and asset['up']=='+Y' and asset['root_scale']==[1,1,1] for asset in assets),
              'Canonical -Z front with negative Y yaw matches north/east/south/west quarter turns.')

        direction = (math.cos(e)*math.cos(az),math.sin(e),math.cos(e)*math.sin(az))
        cb = p['follow']['camera_target_bounds_xz']
        targets3d = [(x,0,z) for x,z in itertools.product((cb['x_min'],cb['x_max']),(cb['z_min'],cb['z_max']))]
        targets3d.append(tuple(p['launch']['fixed_view_target_xyz']))
        max_height = visual['rocket_max_xyz'][1]
        depths = [projection['distance_tiles']-sum((position[j]-target[j])*direction[j] for j in range(3))
                  for target in targets3d
                  for position in itertools.product((0,map_width),(0,max_height),(0,map_depth))]
        calculated['camera_depth_range'] = {'minimum':min(depths),'maximum':max(depths),
                                             'near':projection['near'],'far':projection['far']}
        check('P09_NEAR_FAR_WORLD_ENVELOPE', 0<projection['near']<min(depths)
              and max(depths)<projection['far'],
              'Ground/world-height corners at permitted camera targets fit strictly inside the near/far planes.')
        # Preserve elapsed visible-frame time by splitting, never by clipping dt.
        # A 15fps frame is 1/15s: clipping it to .05s would lose 25% of time.
        follow = p['follow']
        integration_examples = []
        for fps in (15,30,60):
            frame_dt = 1/fps
            count = math.ceil(frame_dt/follow['max_integration_step_seconds'])
            substep_dt = frame_dt/count
            integrated_seconds = sum(substep_dt for _ in range(fps*count))
            integration_examples.append({
                'fps':fps,'frame_dt_seconds':frame_dt,'substeps_per_frame':count,
                'substep_dt_seconds':substep_dt,'integrated_seconds_over_one_second':integrated_seconds,
                'distance_at_camera_speed_cap':integrated_seconds*follow['max_speed_tiles_per_second'],
                'old_clamped_dt_distance_for_comparison':fps*min(frame_dt,.05)*follow['max_speed_tiles_per_second'],
                'within_continuous_visible_frame_threshold':frame_dt<=follow['max_continuous_visible_frame_dt_seconds'],
            })
        calculated['camera_time_integration'] = integration_examples
        check('P10_FOLLOW_AND_REDUCED_MOTION', follow['max_speed_tiles_per_second']>4.5
              and close(follow['max_integration_step_seconds'],.05)
              and close(follow['max_continuous_visible_frame_dt_seconds'],.25)
              and 'max_render_dt_seconds' not in follow
              and all(close(row['integrated_seconds_over_one_second'],1)
                      and row['substep_dt_seconds']<=follow['max_integration_step_seconds']+EPS
                      and close(row['distance_at_camera_speed_cap'],follow['max_speed_tiles_per_second'])
                      and row['within_continuous_visible_frame_threshold']
                      for row in integration_examples)
              and p['manual']['mode']=='STATIC_MANUAL'
              and p['manual']['offscreen_player_indicator'] is True
              and p['manual']['manual_pan_auto_return'] is False
              and p['reduced_motion']['apply_os_only_without_explicit_game_preference'] is True
              and p['launch']['default_camera']=='keep_current'
              and p['launch']['fixed_launch_view_explicit_opt_in'] is True
              and p['launch']['track_rocket'] is False,
              '15/30/60fps visible-frame time is fully integrated in bounded substeps; manual mode and explicit launch view are present. Comfort remains untested.')
        check('P11_EFFECTS_AND_OCCLUSION_SCOPE', all(value is False for value in p['effects'].values())
              and p['occlusion']['material_state_per_instance'] is True
              and p['occlusion']['affects_server_collision'] is False
              and p['occlusion']['affects_interaction_proxy'] is False
              and 0<p['occlusion']['fade_opacity']<1
              and p['occlusion']['release_hold_ms']>p['occlusion']['enter_hold_ms'],
              'Camera/post effects are disabled and instance-local occlusion cannot change gameplay collision or interaction proxies.')

        check('P12_ASSET_IDENTITIES', len(assets)==len(by_id)==a['model_families']==26
              and len(set(a['pilot_order']))==3 and set(a['pilot_order'])<=set(by_id)
              and Counter(asset['geometry_model'] for asset in assets)==a['mesh_generation_by_model'],
              'All 26 asset families have unique IDs and the pilot/model counts resolve.')
        expected_machine_keys = set(b['machines']) | {entry['kind'] for entry in world['starter_entities']}
        bindings = a['machine_bindings']
        source_bindings = a['source_bindings']
        check('P13_MODEL_BINDINGS', set(bindings)==expected_machine_keys
              and set(bindings.values())<=set(by_id)
              and set(source_bindings)==set(b['sources'])
              and set(source_bindings.values())<=set(by_id)
              and all(by_id[bindings[key]]['unlock']==machine['unlock'] for key,machine in b['machines'].items())
              and all(by_id[source_bindings[key]]['unlock']==source['unlock']
                      and by_id[source_bindings[key]]['max_instances_for_this_asset']==source['manual_slots']
                      for key,source in b['sources'].items()),
              'Every machine/starter kind and source item resolves to a model with a compatible unlock.')
        expected_clips = {'idle','locomotion','work_loop','carry_locomotion','celebrate'}
        check('P14_REQUIRED_CHARACTER_CLIPS', set(by_id['worker']['required_clips'])==expected_clips
              and len(by_id['worker']['required_clips'])==len(expected_clips)
              and {'root','hips','hand_left','hand_right'}<=set(by_id['worker']['required_node_aliases'])
              and visual['worker_camera_anchor_uses_animation_bounds'] is False,
              'Five semantic clips and required node aliases are specified; actual clip files and rig quality remain untested.')
        null_fields = ('source_task_id','source_image_task_id','source_credit_cost','shipping_glb_url',
                       'shipping_sha256','measured_lod0_triangles','measured_lod1_triangles','measured_file_bytes')
        check('P15_NO_FABRICATED_GENERATION_OR_MEASUREMENTS', all(asset['status']=='NOT_GENERATED'
              and asset['qa_status']=='NOT_RUN' and asset['reference_status']=='NOT_CREATED'
              and asset['license_status']=='UNVERIFIED' and all(asset[key] is None for key in null_fields)
              for asset in assets) and a['budget_targets']['performance_status']=='TARGET_NOT_MEASURED',
              'All model tasks, release URLs, charges and measured fields remain absent; no asset or performance PASS is fabricated.')
        check('P16_LOD_MATERIAL_AND_TEXTURE_CAPS', all(
              positive_integer(asset['lod0_triangle_cap']) and positive_integer(asset['lod1_triangle_cap'])
              and asset['lod1_triangle_cap']<=asset['lod0_triangle_cap']==asset['target_polycount']
              and positive_integer(asset['material_slot_cap'])
              and asset['material_slot_cap']<=(2 if asset['id']=='worker' else 1)
              and asset['final_basecolor_max_px'] in (256,512,1024)
              and asset['topology']=='triangle' and asset['model_type']=='smart-topology'
              for asset in assets),
              'Triangle LOD targets, material slot caps and texture dimensions are explicit; actual GLB compliance is NOT_RUN.')

        ordinary = [asset for asset in assets if asset['category'] in ('machine','starter')]
        source_assets = [by_id[value] for value in source_bindings.values()]
        expected_bounds = p['expected_asset_bounds_for_validation']
        check('P17_VISUAL_BOUNDS_AND_FLAT_SOURCES', all(
              asset['bounds_max_tiles']['x']<=1.8 and asset['bounds_max_tiles']['z']<=1.8
              and asset['bounds_max_tiles']['y']<=2.4 for asset in ordinary)
              and all(asset['bounds_max_tiles']['y']<=.15 for asset in source_assets)
              and visual['ordinary_machine_max_xyz']==[1.8,2.4,1.8]
              and visual['rocket_max_xyz']==[4.6,8.0,5.6]
              and expected_bounds['rocket_max_xz']==[4.6,5.6]
              and expected_bounds['rocket_max_height']==8.0
              and expected_bounds['source_ground_layer_max_height']==.15
              and visual['source_tray_max_xyz'][1]+visual['source_tray_visual_root_y_offset']<=visual['source_tray_top_above_ground_max']+EPS,
              'Model bounds agree across catalog and camera; shallow sources retain the existing walkable map policy.')

        rocket_counts: Counter = Counter()
        all_stages = ['START','M1','M2','M3','M4','M5','M6']
        for stage in all_stages:
            entry = a['rocket_stages'][stage]
            for aid in entry['new_meshes']:
                rocket_counts[aid] += entry.get('instance_counts',{}).get(aid,1)
        rocket_ids = {asset['id'] for asset in assets if asset['category']=='rocket'}
        assembly = a['rocket_assembly_contract']
        ground_ids,flight_ids = set(assembly['ground_root_children']),set(assembly['flight_root_children'])
        actual_rocket_caps = {
            'standard':sum(by_id[aid]['lod0_triangle_cap']*count for aid,count in rocket_counts.items()),
            'low':sum(by_id[aid]['lod1_triangle_cap']*count for aid,count in rocket_counts.items())}
        calculated['assembled_rocket_counts'] = dict(rocket_counts)
        calculated['assembled_rocket_sum_of_asset_caps'] = actual_rocket_caps
        check('P18_ROCKET_STAGE_REUSE', set(rocket_counts)==rocket_ids
              and rocket_counts['rocket_fin']==4 and rocket_counts['rocket_panel']==8
              and ground_ids|flight_ids==rocket_ids and not ground_ids&flight_ids
              and ground_ids=={'rocket_pad','rocket_gantry'}
              and assembly['world_center_xz']==[24.5,26.0],
              'Rocket reveal is cumulative: four fins/eight panels, with ground and flight roots separated.')

        # Recompute the conservative whole-scene bound independently of the recorded terms.
        max_instances = a['scene_total_built_machine_instances_cap']
        built = [asset for asset in assets if asset['category']=='machine']
        starters = [asset for asset in assets if asset['category']=='starter']
        source_count = sum(asset['max_instances_for_this_asset'] for asset in source_assets)
        bound = a['worst_case_triangle_bound']
        recomputed = {}
        bound_ok = True
        for quality, lod, terms_key, total_key, rocket_envelope in [
            ('standard','lod0_triangle_cap','desktop_terms','desktop_total',32000),
            ('low','lod1_triangle_cap','low_terms','low_total',18000)]:
            terms = {
                'built_machines':max_instances*max(asset[lod] for asset in built),
                'players':runtime['world']['max_players']*by_id['worker'][lod],
                'starters':len(starters)*max(asset[lod] for asset in starters),
                'source_trays':source_count*max(asset[lod] for asset in source_assets),
                'assembled_rocket_envelope':rocket_envelope,
                'cargo_in_flight_and_carried':a['budget_targets']['total_cargo_pod_visual_limit']*by_id['cargo_pod'][lod],
                'crates':a['budget_targets']['maximum_detailed_recovery_crates']*by_id['recovery_crate'][lod],
                'ground_and_markers':5000,
            }
            total = sum(terms.values())
            recomputed[quality] = {'terms':terms,'total':total,'rocket_asset_caps':actual_rocket_caps[quality]}
            bound_ok &= (total==sum(bound[terms_key].values())==bound[total_key]
                         and actual_rocket_caps[quality]<=rocket_envelope
                         and total<=p['quality'][quality]['visible_triangle_cap'])
        calculated['conservative_triangle_bounds'] = recomputed
        check('P19_CONSERVATIVE_GEOMETRY_BOUND', bound_ok
              and recomputed['standard']['total']==339520 and recomputed['low']['total']==132248
              and max_instances==b['caps']['total_placed_machine_entities_excluding_starter']==64
              and source_count==24
              and runtime['world']['max_players']==by_id['worker']['max_instances_for_this_asset']==6
              and a['budget_targets']['rendered_cargo_full_limit']
                    ==b['delivery']['max_links']*b['delivery']['max_in_transit_per_link']==192
              and a['budget_targets']['carried_cargo_pod_limit']==runtime['world']['max_players']==6
              and a['budget_targets']['total_cargo_pod_visual_limit']
                    ==a['budget_targets']['rendered_cargo_full_limit']+a['budget_targets']['carried_cargo_pod_limit']
                    ==by_id['cargo_pod']['max_instances_for_this_asset']==198
              and a['budget_targets']['maximum_detailed_recovery_crates']==by_id['recovery_crate']['max_instances_for_this_asset']
                    ==runtime['limits']['rendered_recovery_crates_detailed']==32,
              'Independent cap arithmetic includes 192 airborne plus 6 carried pods: 339520 standard / 132248 low triangles. These are conditional bounds, not measured scenes.')

        budget = a['budget_targets']
        quality = p['quality']
        check('P20_QUALITY_BUDGET_LINKS', quality['standard']['visible_triangle_cap']==budget['desktop_visible_triangles']==350000
              and quality['low']['visible_triangle_cap']==budget['low_visible_triangles']==150000
              and quality['standard']['frame_draw_call_cap']==budget['desktop_total_frame_draw_calls']==180
              and quality['low']['frame_draw_call_cap']==budget['low_total_frame_draw_calls']==100
              and quality['standard']['target_fps']==60 and quality['low']['target_fps']==30
              and quality['standard']['max_render_pixels']==3686400
              and quality['low']['max_render_pixels']==1048576,
              'Catalog and presentation quality caps agree; draw calls/FPS/download/texture memory are targets, not measured results.')

        pixel_results = []
        for mode in ('standard','low'):
            q = quality[mode]
            for width,height in ((1366,768),(3840,2160),(800,360)):
                for device_dpr in (1,1.5,2):
                    effective = min(device_dpr,q['dpr_cap'],math.sqrt(q['max_render_pixels']/(width*height)))
                    internal_width = math.floor(width*effective)
                    internal_height = math.floor(height*effective)
                    pixel_results.append({'quality':mode,'css_size':[width,height],'device_dpr':device_dpr,
                                          'effective_dpr':effective,'drawing_buffer_size':[internal_width,internal_height],
                                          'drawing_buffer_pixels':internal_width*internal_height,
                                          'pixel_cap':q['max_render_pixels']})
        calculated['dpr_pixel_cap_examples'] = pixel_results
        desktop_4k = next(row for row in pixel_results if row['quality']=='standard' and row['css_size']==[3840,2160] and row['device_dpr']==1.5)
        low_4k = next(row for row in pixel_results if row['quality']=='low' and row['css_size']==[3840,2160] and row['device_dpr']==1.5)
        check('P21_DPR_PIXEL_CAP', all(0<row['drawing_buffer_pixels']<=row['pixel_cap'] for row in pixel_results)
              and quality['standard']['dpr_cap']==1.5 and quality['low']['dpr_cap']==1
              and desktop_4k['drawing_buffer_size']==[2560,1440]
              and low_4k['drawing_buffer_size']==[1365,768],
              'DPR cap formula bounds every reference viewport; 4K renders internally at 2560x1440 standard or 1365x768 low without changing CSS framing.')

        placement = a['source_visual_placement']
        pads = [pad for zone in world['source_zones'] for pad in zone['extractor_pads']]
        pad_rects = [(pad['id'],pad['top_left']['x'],pad['top_left']['z'],
                      pad['top_left']['x']+pad['footprint']['width'],
                      pad['top_left']['z']+pad['footprint']['depth']) for pad in pads]
        tray_results = []
        for zone in world['source_zones']:
            source_asset = by_id[source_bindings[zone['item_id']]]
            half_x,half_z = source_asset['bounds_max_tiles']['x']/2,source_asset['bounds_max_tiles']['z']/2
            for point in zone['manual_service_points']:
                x,z = point['interaction_anchor']['x'],point['interaction_anchor']['z']
                x0,z0,x1,z1 = x-half_x,z-half_z,x+half_x,z+half_z
                intersections = [pid for pid,px0,pz0,px1,pz1 in pad_rects
                                 if min(x1,px1)-max(x0,px0)>EPS
                                 and min(z1,pz1)-max(z0,pz0)>EPS]
                cell_x,cell_z = point['cell']['x'],point['cell']['z']
                tray_results.append({'source':zone['item_id'],'slot':point['slot'],
                                     'root_xyz':[x,placement['visual_root_y'],z],
                                     'declared_xz_bounds':[x0,z0,x1,z1],
                                     'inside_service_cell':cell_x-EPS<=x0 and x1<=cell_x+1+EPS
                                                            and cell_z-EPS<=z0 and z1<=cell_z+1+EPS,
                                     'overlapping_extractor_pad_ids':intersections})
        calculated['source_tray_placements'] = tray_results
        unique_tray_positions = {(row['root_xyz'][0],row['root_xyz'][2]) for row in tray_results}
        check('P22_SOURCE_TRAY_PLACEMENT', placement['count']==len(tray_results)==len(unique_tray_positions)==24
              and placement['offset_xz']==[0,0] and placement['yaw_radians']==0
              and close(placement['visual_root_y'],visual['source_tray_visual_root_y_offset'])
              and placement['marker_overlay_above_tray'] is True
              and placement['collision'].startswith('none;')
              and all(row['inside_service_cell'] and not row['overlapping_extractor_pad_ids'] for row in tray_results)
              and all(not zone['decorative_solid_footprints'] for zone in world['source_zones']),
              'All 24 declared shallow trays sit on exact manual anchors, stay within their service cells, and overlap no extractor pad; no new solid decoration is introduced.')

    except (OSError, ValueError, KeyError, TypeError, IndexError, ZeroDivisionError) as exc:
        check('P99_INPUT_STRUCTURE', False, f'{type(exc).__name__}: {exc}')

    passed = bool(checks) and all(record['passed'] for record in checks)
    result = {
        'validation_kind':'static_presentation_design_accounting_not_runtime_or_asset_tests',
        'passed':passed,'check_group_count':len(checks),'checks':checks,'calculated':calculated,
        'not_run':{'meshy_generation':'NOT_RUN','glb_topology_materials_textures_and_rig':'NOT_RUN',
                   'rendered_frame_performance':'NOT_RUN','motion_comfort_playtest':'NOT_RUN',
                   'browser_interaction':'NOT_RUN','multiplayer_game_acceptance':'NOT_RUN'},
        'limitations':[
            'Projection values are geometry calculations using CSS viewport sizes, not browser screenshots.',
            'Triangle totals assume every future GLB meets its LOD cap and the scene meets instance caps.',
            'A triangle or pixel cap does not prove a draw-call count, texture residency, FPS, or comfort outcome.',
            'Model task IDs, release URLs, licenses and measured fields remain unverified until generation and inspection.',
            'No real game, model asset, browser, network session, or user has been tested by this script.'
        ],
    }
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    for record in checks:
        print(('PASS' if record['passed'] else 'FAIL')+' '+record['id']+' '+record['detail'])
    print('PRESENTATION DESIGN CHECKS', 'PASSED' if passed else 'FAILED', 'GROUPS',len(checks))
    print('Actual models, performance, comfort and game acceptance remain NOT_RUN.')
    return 0 if passed else 1


if __name__=='__main__':
    raise SystemExit(main())
