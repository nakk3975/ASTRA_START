#!/usr/bin/env python3
"""Spatial checks only: boundaries, overlap, service access, population, distance.

Does not claim complete route topology, production throughput or playability.
Usage: python validate_map_v1.py [map_v1.json] [balance_v1.json]
"""
from __future__ import annotations

from collections import Counter, deque
import copy
import json
import math
from pathlib import Path
import sys


def cells_of(e):
    x, z = e["top_left"]["x"], e["top_left"]["z"]
    w, h = e["footprint"]["width"], e["footprint"]["depth"]
    return {(ix, iz) for ix in range(x, x + w) for iz in range(z, z + h)}


def rect_cells(r):
    return {(x, z) for x in range(r["x_min"], r["x_max"] + 1)
            for z in range(r["z_min"], r["z_max"] + 1)}


def bfs(start, walkable):
    seen = {start}
    pending = deque([start])
    while pending:
        x, z = pending.popleft()
        for target in [(x - 1, z), (x + 1, z), (x, z - 1), (x, z + 1)]:
            if target in walkable and target not in seen:
                seen.add(target)
                pending.append(target)
    return seen


def validate(map_path, balance_path):
    d = json.loads(map_path.read_text(encoding='utf-8'))
    b = json.loads(balance_path.read_text(encoding='utf-8'))
    errors = []
    checks = []

    def require(condition, label, detail=None):
        checks.append({"check": label, "passed": bool(condition)})
        if not condition:
            errors.append({"check": label, "detail": detail})

    width, depth = d["dimensions"]["width"], d["dimensions"]["depth"]
    interior = {(x, z) for x in range(1, width - 1) for z in range(1, depth - 1)}
    protected = set().union(*(rect_cells(r) for r in d["protected_walkways"]))
    factory_cells = set().union(*(rect_cells(r) for r in d["factory_regions"]))
    require(width == 48 and depth == 32, "map dimensions 48x32")
    require(len(d["spawn_points"]) == 6, "six spawn points")
    require(len(d["factory_slot_template"]) == 32, "32 reference factory slots")
    require(protected <= interior, "protected walkways stay inside boundary")
    require(d["balance_version_reference"] == b["balance_version"], "balance version matches")

    source_items = {s["item_id"] for s in d["source_zones"]}
    require(source_items == set(b["sources"]), "source items match balance sources")
    for s in d["source_zones"]:
        raw = s["item_id"]
        require(len(s["manual_service_points"]) == b["sources"][raw]["manual_slots"],
                f"{raw}: manual channel count")
        require(len(s["extractor_pads"]) == b["sources"][raw]["extractor_pads"],
                f"{raw}: extractor pad count")
        zone = rect_cells(s)
        for p in s["extractor_pads"]:
            require(cells_of(p) <= zone, p["id"] + ": footprint inside source region")

    reference = d["reference_six_player_entities"]
    count = Counter(e["kind"] for e in reference)
    fleet = b["analysis_assumptions"]["reference_layouts"]["6"]
    for kind, value in fleet.items():
        if kind != "delivery_link":
            require(count[kind] == value, f"reference fleet {kind} count",
                    {"actual": count[kind], "expected": value})
    for e in reference:
        if e["kind"] != "extractor":
            require(cells_of(e) <= factory_cells, e["id"] + ": in factory region")
        for recipe_id in e.get("recipe_ids_example", []):
            require(recipe_id in b["recipes"], e["id"] + ": recipe exists " + recipe_id)
            if recipe_id in b["recipes"]:
                require(b["recipes"][recipe_id]["machine"] == e["kind"],
                        e["id"] + ": machine type matches recipe " + recipe_id)
    per_source = Counter(e["item_id"] for e in reference if e["kind"] == "extractor")
    expected_sources = b["analysis_assumptions"]["extractor_assignments"]["6"]
    require(dict(per_source) == expected_sources, "extractor distribution matches balance",
            {"actual": dict(per_source), "expected": expected_sources})
    require(sum(count.values()) <= b["caps"]["total_placed_machine_entities_excluding_starter"],
            "reference machine count within entity cap")
    require(count["solar_array"] <= b["caps"]["solar_arrays"], "solar count within cap")

    all_pads = [p for s in d["source_zones"] for p in s["extractor_pads"]]
    base = d["starter_entities"] + [d["rocket_envelope"]]
    full = []
    for src in d["factory_slot_template"] + all_pads:
        e = copy.deepcopy(src)
        e["solid"] = True
        full.append(e)
    scenarios = [
        ("starting_world", base),
        ("six_player_reference", base + reference),
        ("all_32_slots_and_all_12_extractors_geometry", base + full),
    ]
    scenario_reports = []
    for scenario_id, entities in scenarios:
        occupied = {}
        duplicate_cells = []
        entity_ids = [e["id"] for e in entities]
        require(len(entity_ids) == len(set(entity_ids)), scenario_id + ": unique entity ids")
        for e in entities:
            cells = cells_of(e)
            require(cells <= interior, scenario_id + " " + e["id"] + ": inside map")
            require(not (cells & protected), scenario_id + " " + e["id"] + ": no protected-road overlap",
                    sorted(cells & protected))
            for c in cells:
                if c in occupied:
                    duplicate_cells.append({"cell": c, "entities": [occupied[c], e["id"]]})
                occupied[c] = e["id"]
        require(not duplicate_cells, scenario_id + ": no solid overlap", duplicate_cells)
        walkable = interior - set(occupied)
        start = (23, 16)
        require(start in walkable, scenario_id + ": BFS seed walkable")
        reached = bfs(start, walkable) if start in walkable else set()
        targets = []
        for e in entities:
            for i, s in enumerate(e["service_points"], 1):
                targets.append((e["id"] + f".service{i}", s["cell"]))
                cell_center = (s["cell"]["x"] + 0.5, s["cell"]["z"] + 0.5)
                anchor = s["interaction_anchor"]
                distance = math.hypot(cell_center[0] - anchor["x"], cell_center[1] - anchor["z"])
                require(distance <= b["player"]["base_interaction_range_tiles"],
                        scenario_id + " " + e["id"] + f": service{i} in interaction range")
        targets += [(f"spawn{i}", p) for i, p in enumerate(d["spawn_points"], 1)]
        for s in d["source_zones"]:
            targets += [(s["id"] + f".manual{i}", p["cell"])
                        for i, p in enumerate(s["manual_service_points"], 1)]
        missed = [{"target": name, "cell": p} for name, p in targets
                  if (p["x"], p["z"]) not in reached]
        require(not missed, scenario_id + ": all required service points reachable", missed)
        require(protected <= reached, scenario_id + ": all protected walkways connected")
        require(len(reached) == len(walkable), scenario_id + ": no isolated walkable cell",
                {"reachable": len(reached), "walkable": len(walkable)})
        scenario_reports.append({
            "scenario": scenario_id, "solid_entities": len(entities),
            "solid_cells": len(occupied), "walkable_cells": len(walkable),
            "reachable_cells": len(reached), "required_service_targets": len(targets),
            "unreachable_targets": missed,
        })

    entities_by_id = {e["id"]: e for e in base + reference}
    max_dist = b["delivery"]["max_distance_tiles"]
    speed = b["delivery"]["travel_speed_tiles_per_second"]
    tick_seconds = b["tick_ms"] / 1000
    probes = []

    def produced_items(e):
        if e["kind"] == "extractor":
            return {e["item_id"]}
        if e["kind"] == "shared_warehouse":
            return set(b["items"])
        return {item for rid in e.get("recipe_ids_example", []) for item in b["recipes"][rid]["output"]}

    def accepted_items(e):
        if e["kind"] == "shared_warehouse":
            return set(b["items"])
        if e["kind"] == "rocket":
            return {item for milestone in b["milestones"] for item in milestone["base_targets"]}
        return {item for rid in e.get("recipe_ids_example", []) for item in b["recipes"][rid]["input"]}

    for p in d["distance_probe_pairs"]:
        a = entities_by_id[p["from"]]["delivery_distance_anchor"]
        c = entities_by_id[p["to"]]["delivery_distance_anchor"]
        distance = math.hypot(a["x"] - c["x"], a["z"] - c["z"])
        allowed = distance <= max_dist
        compatible = None
        if "item_filter" in p:
            compatible = (p["item_filter"] in produced_items(entities_by_id[p["from"]])
                          and p["item_filter"] in accepted_items(entities_by_id[p["to"]]))
            require(compatible, f"probe {p['from']} -> {p['to']}: compatible item filter")
        probes.append({
            **p, "distance_tiles": round(distance, 6), "within_24_tile_limit": allowed,
            "item_filter_compatible": compatible,
            "travel_ticks_if_allowed": max(1, math.ceil(distance / speed / tick_seconds)) if allowed else None,
            "interpretation": "distance and named-filter compatibility only; milestone timing, complete topology and delivery capacity are not proven here",
        })
    for i, p in enumerate(probes):
        expected = i < 9
        require(p["within_24_tile_limit"] == expected, f"distance probe {i + 1}: expected boundary result", p)

    left = [e for e in reference if e.get("factory_region") == "factory_a" and e.get("delivery_allowed")]
    right = [e for e in reference if e.get("factory_region") == "factory_b" and e.get("delivery_allowed")]
    distances = []
    for a in left:
        for c in right:
            pa, pc = a["delivery_distance_anchor"], c["delivery_distance_anchor"]
            distances.append((math.hypot(pa["x"] - pc["x"], pa["z"] - pc["z"]), a["id"], c["id"]))
    closest = min(distances)
    require(closest[0] <= max_dist, "at least one west-east port pair within delivery limit")
    report = {
        "passed": not errors, "check_count": len(checks), "failed_check_count": len(errors),
        "errors": errors, "scenarios": scenario_reports,
        "reference_regular_machines": sum(count.values()) - count["extractor"],
        "reference_extractors": count["extractor"],
        "unused_regular_template_slots": len(d["factory_slot_template"]) - (sum(count.values()) - count["extractor"]),
        "closest_west_east_reference_centers": {
            "distance_tiles": round(closest[0], 6), "from": closest[1], "to": closest[2],
            "note": "Hub and solar entities are excluded. Geometric closeness alone does not make an item-compatible route.",
        },
        "distance_probes": probes,
        "limits": [
            "No completed delivery-route topology or 32-link sufficiency proof.",
            "No production throughput, unlock-order or human playthrough timing proof.",
            "No browser collision implementation, rendering performance or 6-client session test.",
            "BFS uses 4-neighbor tile centers with point connectivity; runtime actor-radius collision still needs implementation tests.",
            "Reference factory_slot service directions cover 0/90/180/270 in templates and source pads.",
        ],
        "checks": checks,
    }
    return report


def report_markdown(r):
    lines = [
        "# 지도 배치와 접근성 검증 결과", "",
        f"- 결과: {'PASS' if r['passed'] else 'FAIL'}",
        f"- 검사 수: {r['check_count']}",
        f"- 실패 수: {r['failed_check_count']}",
        "- 검증 범위: 지도 경계, 고체 충돌, 보호 통로, 4방향 BFS 접근성, 설정 인원과 설비 수, 배송 거리.",
        "- 미검증 범위: 실제 게임 구현, 충돌 반경, 생산망 전체 토폴로지, 공급량과 완주 시간.", "",
        "## 배치 시나리오", "",
        "| 시나리오 | 고체 개체 | 고체 칸 | 보행 칸 | 도달한 칸 | 필수 접근점 |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for s in r["scenarios"]:
        lines.append(f"| {s['scenario']} | {s['solid_entities']} | {s['solid_cells']} | {s['walkable_cells']} | {s['reachable_cells']} | {s['required_service_targets']} |")
    lines += ["", "## 배송 거리 확인", "",
              "24 tile은 송신과 수신 포트 중심 사이 거리 제한이다. 배송 허브의 설치 위치를 중심으로 하는 범위가 아니다.",
              "아래 표는 특정 쌍의 거리 가능성만 확인한다. 32개 링크로 모든 생산을 자동화할 수 있다는 증명이 아니다.", "",
              "| 출발 | 도착 | 거리 tile | 거리 통과 | 이동 tick |",
              "| --- | --- | ---: | --- | ---: |"]
    for p in r["distance_probes"]:
        lines.append(f"| {p['from']} | {p['to']} | {p['distance_tiles']:.3f} | {'가능' if p['within_24_tile_limit'] else '초과'} | {p['travel_ticks_if_allowed'] or '-'} |")
    lines += ["", "## 읽는 방법", "",
              "- 도면의 P, F, R, A, X, S, HUB는 후반 배치 예시다. 새 게임에 자동 지급하지 않는다.",
              "- 새 게임은 작업대 WB, 공유 창고 WH, 비상 회수함 RV, 시작 발전기 GEN과 빈 로켓 공사 구역만 가진다.",
              "- 일반 공장 32개 예시 슬롯 중 25개를 사용하고 7개가 남는다. 자동 수거기 9대는 별도 소스 패드에 설치한다.",
              "- 공유 창고의 폐전선은 가까운 우측 전선 가공기에 공급할 수 있다. 생산된 전선은 좌측 회로 제작기로 보낼 수 있다. 설비는 자기 레시피의 입력만 받으며 임의 자원의 중계점으로 쓸 수 없다.",
              "- 모든 빈 셀의 연결성과 필수 작업점 접근을 검사했지만 캐릭터 반경을 포함한 런타임 충돌은 구현 후 별도로 검증해야 한다.", ""]
    if r["errors"]:
        lines += ["## 실패", "", json.dumps(r["errors"], ensure_ascii=False, indent=2), ""]
    return "\n".join(lines)


if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    map_path = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "map_v1.json"
    balance_path = Path(sys.argv[2]) if len(sys.argv) > 2 else root / "balance_v1.json"
    result = validate(map_path, balance_path)
    (map_path.parent / "map_validation.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (map_path.parent / "map_validation.md").write_text(report_markdown(result), encoding="utf-8")
    print(json.dumps({
        "passed": result["passed"], "checks": result["check_count"],
        "failed": result["failed_check_count"], "scenarios": result["scenarios"],
        "errors": result["errors"]
    }, ensure_ascii=False, indent=2))
    sys.exit(0 if result["passed"] else 1)
