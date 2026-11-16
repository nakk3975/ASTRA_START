"""Map genuinely executed evidence to complete acceptance scenarios.
Partial coverage stays NOT_RUN; original design CSV is never modified.
"""
import csv,json,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
unit=(root/'docs/qa/evidence/unit-tests.txt').read_text()
assert 'pass 24' in unit and 'fail 0' in unit
live=json.loads((root/'docs/qa/evidence/live-integration.json').read_text())
assert live['status']=='PASS'
executed={t['id'] for t in live['tests'] if t['status']=='PASS'}
full=json.loads((root/'docs/qa/evidence/core-full-runs.json').read_text())
assert {r['planned'] for r in full['results']}=={1,6}
network=json.loads((root/'docs/qa/evidence/network-full-runs.json').read_text())
assert network['status']=='PASS'
assert {r['planned'] for r in network['results']}=={1,6}
assert all(r['status']=='PASS' and r['allClientsReceivedLaunch'] and r['durableReloadHashMatches'] and not r['resourceInjection'] and not r['teleportation'] for r in network['results'])
complete={
'UX09':('browser-m1.json','실제 브라우저 채집: 고철 12 → 20+4 → 20+6. 기존 스택 우선 채움과 새 슬롯 분배, 수량 합계 확인.'),
'T01':('live-integration.json#T01-final-item-six-concurrent','실제 6개 WS 동시 요청. 명시적 재고 fixture: 1명 획득, 5명 거절, 총량 1.'),
'T02':('live-integration.json#T02-footprint-six-concurrent','실제 6개 WS의 같은 footprint 요청: 설비 1개, 비용 1회, 5개 OCCUPIED. fixture 사용.'),
'T03':('live-integration.json#T03-hundred-retries-and-reconnect','실제 자원 이동 commandId를 100회 재전송한 뒤 같은 게스트 새 연결에서 재전송. 동일 receipt, 총 효과 1.'),
'T04':('live-integration.json#T04-command-quantity-reuse','동일 commandId의 quantity 변경에 IDEMPOTENCY_KEY_REUSED 확인.'),
'T10':('live-integration.json#T10-missing-event-preserves-corrupt-save','실제 PostgreSQL: 최신 snapshot 손상 시 이전+delta hash 일치, delta 제거 시 SAVE_CORRUPT와 원래 head 보존.'),
'T14':('unit-tests.txt','코어 fixture 시험: WIP 취소의 입력 부족 공간 거부, job/escrow/예약 불변 확인. DB 장애 시험은 아님.'),
'R01':('unit-tests.txt','원본 JSON 목표를 단계별 올림: 6인 전선 11/32/52=95 직접 확인.'),
'R02':('core-full-runs.json','코어 완주 및 실제 브라우저 M1 완료. 고철/폐전선 직접 채집, 주괴·판·기어·전선 수동 제작, 운반·납품·혼자 조립으로 M2 진입.'),
'R07':('unit-tests.txt','코어 fixture: M5 실제 점검 거부, M6 뒤 각각 39tick 미완료/40tick 완료, 세 점검 이후 발사 제안 성공.'),
'R08':('unit-tests.txt','코어 fixture로 투표/99tick 뒤 카운트다운 취소 및 재시도, 연료 보존과 발사 후 정지 확인. 실제 M6 납품량은 core-full-runs로 별도 확인.'),
'R13':('unit-tests.txt','새 world에 예시 자동공장/수거기/무료 재고 없음. starter 기반 초기화 확인.'),
'R15':('live-integration.json#R15-code-does-not-grant-ownership','실제 일반 게스트의 코드 회전/복구키 회전/삭제 3명령 거절, 일반 초대코드로 owner 복구 거절.'),
'R16':('unit-tests.txt','코어 fixture: MANUAL+NO_CONNECTED에서 재접속 시 MANUAL 유지; 재개 명령으로 STORAGE_PENDING 제거 안 됨.'),
'R21':('unit-tests.txt','고철80/창고200/입력20/출력주괴20 포화 fixture에서 현장 임시 보관→작업대 입출력 회수→제조법 교체, 총량 보존.'),
}
partial={
'UX01':'1인 실제 HTTP/WS/DB 발사 완주 성공(가속 논리 시계). 정상 시간 브라우저 M1 완료. 브라우저 전체 발사 완주는 미실행.',
'UX02':'6개 독립 게스트 소켓 입장/준비/시작과 7번째 거부 확인. 6개 브라우저 시각 확인은 미실행.',
'UX06':'코어 6채널 동시 제작 및 실제 WS private StateView 격리 확인. 6인 UI 전체 시나리오는 미실행.',
'UX35':'코어 3점검 순차 수행/발사 확인. 실제 게임 화면 최종 단계 시험 미실행.',
'UX39':'브라우저 서버 재시작 후 재접속과 가방 보존, 소켓 게스트 재접속 확인. 네트워크 차단 조합 전체 미실행.',
'UX40':'실제 무접속 500ms tick 정지와 DB 재로딩 확인. 장시간/기기수면 조합은 미실행.',
'UX41':'1366×768 HUD/패널과 외부 스크롤 없음 확인. 전체 게임 흐름은 미실행.',
'UX42':'3840×2160 CSS viewport HUD/로켓 패널과 외부 스크롤 없음 확인. 전체 게임 흐름/GPU 검수는 미실행.',
'UX43':'800×360 조작 버튼/패널 배치 확인. 실제 휴대전화 터치만으로 완주는 미실행.',
'UX44':'360×800 회전 안내와 가로 복귀 관찰. 실제 기기의 입력 유지 중 회전 시험은 미실행.',
'UX48':'WebGL 없는 시험 브라우저는 2D 호환 렌더러 사용. GPU 품질 전환의 실제 렌더링 비교는 미실행.',
'T09':'실제 PostgreSQL 두 writer와 stale epoch COMMIT 거부 확인. 실제 network partition+lease 만료 조합은 미실행.',
'T12':'코어 6채널 제작·용량 예약과 실제 개인 데이터 분리 확인. 마지막 출력 공간+가방full 전체 조합 미실행.',
'T15':'코어 hold 500ms 만료와 120초 채널 WIP 현장 회수 확인. 숨김/통신/재배정 전체 조합 미실행.',
'T18':'코어 희소 source A/B 분배와 마지막 목적지 예약 확인. C 경쟁·장거리·저전력·복구 전체 조합 미실행.',
'T24':'코어 예약 좌석과 재접속, 만료 회수 확인. 실제 동시 네트워크 경합은 미실행.',
'T25':'실제 새 연결 제어 epoch 교체 및 코어 stale epoch 거부 확인. 이전 탭의 지연 건설 패킷 시험은 미실행.',
'T29':'실제 Origin/CSRF와 strict 명령 파싱 검증. 만료/재사용 ticket·flood·8KiB 전송 전체 조합 미실행.',
'R04':'수거기 MK2 중복 강화 거부와 작업 결과 확인. 일반 가공기 MK2 실제 비교 전체 시나리오 미실행.',
'R05':'수거기 출력20 포화 확인. 전력 부족과 장시간 조합 미실행.',
'R18':'현장 상자 footprint 덮기 거부 및 수거 후 삭제 확인. 실제 철거부터 이어지는 조합 미실행.',
'R19':'코어 소유권 합의와 다른 접속자 있는 삭제 거부 확인. 이전 복구 키 폐기 포함 전체 시나리오 미실행.',
'R20':'코어 개인 비용 부족 및 보호구역 배치 거부 확인. 실제 원거리 UI 조합 미실행.'
}
with (root/'design/acceptance_tests.csv').open(encoding='utf-8-sig',newline='') as f:
 reader=csv.DictReader(f);fields=reader.fieldnames;rows=list(reader)
assert len(rows)==99
for r in rows:
 if r['id'] in complete:
  evidence,note=complete[r['id']]
  if '#' in evidence: assert evidence.split('#')[1] in executed
  r.update(status='PASS',evidence='docs/qa/evidence/'+evidence,notes=note)
 else:
  r.update(status='NOT_RUN',evidence='',notes=partial.get(r['id'],'전체 시나리오 미실행. 구현 또는 부분 시험만으로 PASS 처리하지 않음.'))
with (root/'docs/qa/acceptance_tests.csv').open('w',encoding='utf-8-sig',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=fields,lineterminator="\n");writer.writeheader();writer.writerows(rows)
print(json.dumps({'total':len(rows),'PASS':len(complete),'NOT_RUN':len(rows)-len(complete),'liveCases':len(live['tests'])}))
