# 지도 배치와 접근성 검증 결과

- 결과: PASS
- 검사 수: 446
- 실패 수: 0
- 검증 범위: 지도 경계, 고체 충돌, 보호 통로, 4방향 BFS 접근성, 설정 인원과 설비 수, 배송 거리.
- 미검증 범위: 실제 게임 구현, 충돌 반경, 생산망 전체 토폴로지, 공급량과 완주 시간.

## 배치 시나리오

| 시나리오 | 고체 개체 | 고체 칸 | 보행 칸 | 도달한 칸 | 필수 접근점 |
| --- | ---: | ---: | ---: | ---: | ---: |
| starting_world | 5 | 46 | 1334 | 1334 | 46 |
| six_player_reference | 39 | 182 | 1198 | 1198 | 80 |
| all_32_slots_and_all_12_extractors_geometry | 49 | 222 | 1158 | 1158 | 90 |

## 배송 거리 확인

24 tile은 송신과 수신 포트 중심 사이 거리 제한이다. 배송 허브의 설치 위치를 중심으로 하는 범위가 아니다.
아래 표는 특정 쌍의 거리 가능성만 확인한다. 32개 링크로 모든 생산을 자동화할 수 있다는 증명이 아니다.

| 출발 | 도착 | 거리 tile | 거리 통과 | 이동 tick |
| --- | --- | ---: | --- | ---: |
| extractor_metal_scrap_1 | processor_ingot_1 | 9.220 | 가능 | 47 |
| extractor_metal_scrap_3 | processor_ingot_4 | 18.028 | 가능 | 91 |
| extractor_plastic_scrap_3 | processor_polymer_1 | 19.235 | 가능 | 97 |
| extractor_cable_scrap_1 | processor_wire | 19.698 | 가능 | 99 |
| extractor_energy_shard_1 | refinery_1 | 18.439 | 가능 | 93 |
| processor_polymer_2 | refinery_2 | 21.000 | 가능 | 105 |
| processor_wire | fabricator_circuit_1 | 9.000 | 가능 | 45 |
| shared_warehouse | processor_wire | 21.932 | 가능 | 110 |
| assembler_engine | rocket | 17.357 | 가능 | 87 |
| shared_warehouse | extractor_cable_scrap_1 | 41.629 | 초과 | - |
| shared_warehouse | refinery_2 | 30.364 | 초과 | - |

## 읽는 방법

- 도면의 P, F, R, A, X, S, HUB는 후반 배치 예시다. 새 게임에 자동 지급하지 않는다.
- 새 게임은 작업대 WB, 공유 창고 WH, 비상 회수함 RV, 시작 발전기 GEN과 빈 로켓 공사 구역만 가진다.
- 일반 공장 32개 예시 슬롯 중 25개를 사용하고 7개가 남는다. 자동 수거기 9대는 별도 소스 패드에 설치한다.
- 공유 창고의 폐전선은 가까운 우측 전선 가공기에 공급할 수 있다. 생산된 전선은 좌측 회로 제작기로 보낼 수 있다. 설비는 자기 레시피의 입력만 받으며 임의 자원의 중계점으로 쓸 수 없다.
- 모든 빈 셀의 연결성과 필수 작업점 접근을 검사했지만 캐릭터 반경을 포함한 런타임 충돌은 구현 후 별도로 검증해야 한다.
