# 최신 개발 변경 — 3.1.2 / 배포 대기 (2026-11-17 KST)

GitHub 기존 개발 브랜치 `codex/resume-meshy-pilot-20261117`와 draft PR#1을 이어서 작업했다. 기존 사이트는 **v8 / 3.1.1**이며 이번 변경은 아직 배포하지 못했다. 실행 환경이 103개 단위시험·타입검사·빌드와 6개 실제 WS/PG 검증 후 배포 준비 도중 연결 해제됐다. 연결 가능한 GitHub 도구로 검증한 패치를 기존 8344ce756e22b3caf7678150feb3614ccb705a37 베이스에 재적용해 저장했다. 복구 커밋 자체는 재실행하지 못했으므로 다음 작업에서 반드시 npm run check, npm run test:carry:network 후 게시한다.

변경: MotionSmoother.player로 E 대상/HUD/기계패널/설치 고스트/C 재중앙에 동일한 표시 위치와 방향을 사용. checkpoint로 행동 직전 이동 구간을 봉인. CarryConnection.actionBarriers와 MovePacket.actionAfter로 행동 이전 이동이 모두 적용된 뒤 명령을 한 번 처리하고, 행동 이후 이동은 ACK 뒤 전송. 일반 HTTP 요청 중에도 행동을 우선 전송. 재접속 시 이전 이동 barrier만 해제하고 동일한 명령 ID를 보존. 마지막 적용 이동 방향과 실제 표시 변위 기반 걷기 보정. 신규 회귀시험 6개, 실제 WS 시험의 분할 이동 후 행동 대기 추가.

docs/carry/INTERACTION_3_1_2.md가 이번 변경·검증·중단 상태의 기준이다. 저장 규칙 quarry-3.1.0, 자금/재료/레시피/광맥/모델은 유지. 신규 모델 생성 없음. 원격 브라우저 WebGL2 미지원으로 GPU 외관/FPS/사람의 체감은 미검증. 벽 주변 분할 적분에 약 0.6~1.1cm 잔여 표시 오차도 관측되어 모든 지형의 정확성을 완료했다고 말하지 않는다.

다음: GitHub 이 브랜치의 최신 코드를 기준으로 재검증하고, Sites v8 소스 위에 이번 변경만 병합한 뒤 helper로 push/package/deploy. Sites ID와 소유자 전용 범위 유지. main 미병합. 환경 중단 전 로컬 README wrapper 갱신은 GitHub 게임 루트 README와 다르므로 게시 체크아웃의 루트 README도 실제 Worker/D1 게임 설명으로 고친다.

# 최신 변경 — 3.1.1 (2026-11-17 KST)

고주사율(144/240/360Hz)에서 HTTP 왕복 360ms가 겹치면 90프레임 이동 대기열이 가득 차 이동이 누락되는 결함을 재현해 수정했다. 미전송 입력만 50ms로 합치며 전송한 seq는 수정하지 않는다. tests/movement-refresh.test.ts 5개 추가, 총97개 테스트 및 타입/빌드·실제6WS/PG 통과. 기계0등급 6종을 starter-machines.ts의 개별 수공구 외형으로 교체. 유료 생성 없음. 기존 저장 규칙 quarry-3.1.0 유지. 상세 docs/carry/REFRESH_3_1_1.md.

이번 재개 시점에 Sites v7은 quarry-3.1이었지만 GitHub PR#1은 workshop-3.0 dda035c에 머물러 있었다. f22f8c3의 source 원본 SHA와 GitHub tree를 비교해 충돌이 없는 변경만 합쳐 동기화한다. 다음 작업자는 Sites get_site와 PR head를 조회해 최신 커밋을 확인할 것. source/migrations/001_initial.sql은 기존 GitHub 원문으로 복구했다. 오프라인 렌더는 3D 게임 실행 캡처가 아니다. GPU 검수 불가 상태를 완료로 표기하지 말 것.

# 이전 변경 — quarry-3.1.0

현재 최신 요청은 키업 후 재이동/멈칫함과 부자연스러운 폐기물 광맥을 수정하는 것이다. 입력 구간 seq/dt와 서버 ack를 사용하며 예측은 CarryConnection.movement 하나로 공유한다. 키업 즉시 전송, 역순 제어 차단, 중복 이동 차단, 서버 시간 예산. 정사영 카메라의 지연 이동 제거. 새로운 movement-transport 테스트 및 실제 WS 정지 검증 추가. 상세 `docs/carry/QUARRY_3_1.md`.

광물은 철광석·구리광석·규석·석탄(석탄층). 내부 ID 보존. 4개 자연 암반 Meshy 모델 60크레딧으로 교체 완료, 잔액2339. 성공 모델 재생성 금지. `docs/carry/quarry-generation.json`에 출처·작업ID·해시. 기존29종58GLB 유지. 새 모델은 bounds1.8×1.25×1.8(석탄 높이1.05)이므로 이전 수거함 scale2.2/3/2.2를 재적용하지 말 것. 지형은 quarry-environment.ts, CPU외관렌더 스크립트와 증거 포함. 기존3.0저장 자금/설비/연구 보존.

검증: 설계/92테스트/타입/빌드 및 실제6WS+PG. 지연·역순 HTTP 재현에서 정지 후 표시 변위0. 원격 브라우저 WebGL2 미지원이 계속되므로 실시간3D/FPS/사용자 체감 미검증. 오프라인 렌더를 게임 캡처로 말하지 말 것. 최신 게시 결과는 `docs/carry/evidence/quarry-publication.json`, `quarry-production-smoke.json` 기준.

아래는 이전 버전 작업 기록이다.

# 고철에서 우주까지 — 작업 재개 기준

2026-11-17 KST. 저장소 nakk3975/ASTRA_START, 브랜치 codex/resume-meshy-pilot-20261117, PR https://github.com/nakk3975/ASTRA_START/pull/1. main 병합 전. 최신 코드는 이 브랜치이며 현재 규칙은 **workshop-3.0.0**입니다.

최신 요청 반영: 이동 예측/서버 보정/원격 보간, 경사로 경계 멈춤 수정. 빈 공방+시작80코인, 40코인 작업대 상자 구매·직접 설치. 운반1→8, 이속5단계+30%, 짐운반·도구·레일·가공·자동화 분기, 기계4등급, 광맥각5등급. 가공XP/판매·납품코인 분리. 기존 저장·설비·자금 보존 마이그레이션. 상세 docs/carry/GROWTH_3_0.md.

사람 캐릭터4종: worker + worker-engineer/mechanic/pilot. 이번3종 생성45크레딧, 확인잔액2399. 성공작 재생성 금지. 18본/5클립/2LOD, 29종58GLB. 출처/작업ID는 docs/carry/character-generation-v2.json. 공급자 license 필드 부재 상태 유지.

검증: 89테스트·설계·타입·빌드 PASS, 실제6개 WS+PG 재시작 PASS, 1/2/4/6인 목표량 단일 이동봇 구매부터 발사까지 PASS. 사람이 협동한 플레이 시간은 아님. 증거 docs/carry/evidence/growth-*.json/jpg. GPU는 원격브라우저 WebGL2 미지원으로 미검증. UI구매/자금/캐릭터 변경은 확인. GPU/FPS가 검증됐다고 말하지 말 것.

Sites ID appgprj_6afbab1bae9c8191a78a6b95da2ba905, https://scrap-to-orbit-model-review.dsfs3975.chatgpt.site. 기존 소유자전용 범위 유지. 새 Site를 만들거나 임의공개하지 말 것. .sites-checkout/source는 저장소 복사본. 최신 게시 결과는 growth-publication.json 및 growth-production-smoke.json 참조(이전 publication.json/production-smoke.json은 v5 기록). 신규 변경은 helper로 정확한 source를 push/package한 뒤 기존 Site에 게시.

packages/carry-core는 공통 규칙, apps/web/src/carry는 새게임, apps/server/src/carry는 WS+PG, apps/sites-worker는 HTTP+D1. /legacy는 이전 v1을 별도 보존. npm run check, npm run test:carry:network, npm run test:carry:campaign, node --import tsx tests/carry-campaign.ts 2/4/6. Node24.22.1.
