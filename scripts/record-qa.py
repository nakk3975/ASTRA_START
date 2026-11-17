"""Record only scenarios fully supported by evidence from the current v1.1 run.
GPU-blocked or partially tested scenarios never become PASS.
"""
import csv,json,pathlib,collections
root=pathlib.Path(__file__).resolve().parents[1]
live=json.loads((root/'docs/qa/evidence/live-integration.json').read_text());assert live['status']=='PASS'
complete={
'T01':('live-integration.json','6개 소켓 최종 자원 경쟁. fixture 1개, 1회 획득/5회 거절.'),
'T02':('live-integration.json','6개 소켓 같은 footprint 경쟁. 1기 설치/1회 비용/5회 거절.'),
'T03':('live-integration.json','동일 명령 100회 재전송과 재접속 뒤 재전송. 총 효과 1회.'),
'T04':('live-integration.json','동일 commandId의 수량 변경 거부.'),
'T10':('live-integration.json','손상 snapshot 대체 재생; delta 누락 시 SAVE_CORRUPT와 원본 head 보존.'),
'T14':('v11-checks.txt','코어 fixture: WIP 취소 공간 부족 거부와 escrow 보존.'),
'R01':('v11-checks.txt','원본 목표와 인원 배율의 단계별 올림 검증.'),
'R07':('v11-checks.txt','M6 이후 세 점검 필요; 각각 40tick 완료.'),
'R08':('v11-checks.txt','투표/취소/재시도 연료 보존과 발사 후 정지.'),
'R13':('v11-checks.txt','새 방에 무료 예시 공장/재고 없음.'),
'R15':('live-integration.json','초대코드는 소유권을 부여하지 않음. 일반 게스트의 관리 작업 거부.'),
'R16':('v11-checks.txt','무접속 재입장 뒤 수동 일시정지 유지.'),
'R21':('v11-checks.txt','가방·창고·채널 포화에서 현장 임시 보관과 수거로 복구, 총량 보존.')}
with(root/'design/acceptance_tests.csv').open(encoding='utf-8-sig',newline='')as f:reader=csv.DictReader(f);fields=reader.fieldnames;rows=list(reader)
assert len(rows)==160
for i,r in enumerate(rows):
 if r['id']in complete:
  evidence,note=complete[r['id']];r.update(status='PASS',evidence='docs/qa/evidence/'+evidence,notes=note)
 elif r['category'] in ['CAMERA','ASSET','VISUAL_INTEGRATION']:r.update(status='NOT_RUN',evidence='docs/qa/evidence/browser-v11.json',notes='첫 세 모델 GPU 검수 BLOCKED. 수학/GLB 파일 검사만으로 화면·26개 모델·성능 시나리오를 PASS 처리하지 않음.')
 else:r.update(status='NOT_RUN',evidence='',notes='전체 인수 시나리오 미실행. 부분 코어/소켓 검증은 V1_1_REPORT.md 참고. 이전 브라우저 증거는 새 렌더러 검증에 재사용하지 않음.')
with(root/'docs/qa/acceptance_tests.csv').open('w',encoding='utf-8-sig',newline='')as f:writer=csv.DictWriter(f,fieldnames=fields,lineterminator='\n');writer.writeheader();writer.writerows(rows)
print(dict(collections.Counter(r['status']for r in rows)))
