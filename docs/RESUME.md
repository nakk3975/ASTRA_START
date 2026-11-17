# 현재 이어갈 지점 — 3.4.0 (2026-11-18 KST)

최신 요청: 철판 설치 후 화면 정지 및 3D 재시작 시 빈 화면, 운반 팔·걷기 동작, 재료 기반 자동 가공.

- 로켓 `traverse` 안의 `release`가 순회 중 자식을 제거해 `undefined.traverse` 예외를 일으키는 것을 실제 Three.js로 재현했다. 같은 정리 방식이 dispose에도 있어 React effect 정리가 실패했다. `releaseTree`는 콜백을 수집한 뒤 호출하고, Visual/CarryView 해제를 중복 호출해도 안전하다. 로켓 설치마다 모델을 전부 다시 만들지 않고 재사용하며, LOD 변경 때만 교체한다.
- `automaticRecipe`: 첫 투입 재료로 가공 결정, 현재 로켓 단계의 부족한 부품을 우선. 철광석→주괴→철판, 조합 재료가 대기 중이면 선택을 유지. 레시피 메뉴 제거, 투입 미리보기·추가 재료 표시. 기존 부분 투입 작업 보존. 자동화 상자는 별도 workbench에서 적게 보유한 설비 우선, 구매도 유지.
- `WorkerMotion`: 실제 이동 거리 기반 보폭, 정지 후 중립 다리 복귀, 2관절 팔 계산과 두 손 가운데에 물건 배치. 4캐릭터×2LOD 실제 뼈 위치 검증. 원본 GLB 파일은 변경하지 않음.
- 인증/세션 등 4xx는 재연결 버튼 표시, 일시 통신 실패는 지수 간격으로 재시도. 80ms 오류 요청 반복 방지, 15초 요청 제한. 기존 저장·돈·설비·광맥 보존, 규칙 quarry-3.4.0.
- 검증: `npm run check` 135개 테스트와 TypeScript/Vite 통과. 1/2/4/6인 목표량 단일 이동 봇이 수동 RECIPE 명령 0회로 발사. 실제 6개 WebSocket+PostgreSQL 재시작 시험 통과. 브라우저 v3.4.0 새 작업장·재시작 후 HUD 유지 확인.
- QA 브라우저 WebGL2 미지원으로 실제 GPU 화면, FPS, 관절 외관/사람의 조작감은 미검증. CPU 테스트는 이를 대체한다고 주장하지 않는다.
- 상세 `docs/carry/RECOVERY_3_4.md`. 기존 Site와 GitHub draft PR #1 유지. 다음 작업자는 최신 Sites/PR head를 조회할 것.

# 이전 변경 — 3.3.0 (2026-11-17 KST)

최신 요청: 철판 제작 안내, 판매소 제거와 설치당 보상, 작업 진행 게이지, 화면 확대·휠 줌·다양한 효과음.

- 철 주괴1 → 철판1. 낡은 작업대 근처 ‘② 철판 만들기’ 버튼, 투입/출력/소요 시간 안내. 기존 초반 안내가 제작 메뉴를 덮는 문제를 !machine 조건으로 해결.
- 판매소 모델·타깃·보상 제거. 옛 SELL 명령은 안전하게 거절. 로켓 설치만 보상, 철판1/구리선2/내열재3/회로·선체4/연료5/엔진6/항법7. 품질+등급 코인. 단계 보너스 없음. 설비 배치/재설치는 돈을 주지 않음.
- 판매 없이도 완료하도록 필수 광맥은 XP12/24/60 무료 순차 해금. 기본 작업대도 XP24에서 중간 부품, XP50에서 엔진·항법 제작. 강화는 속도·출력 공간에만 영향. 구매·강화 가격을 새 화폐 단위에 맞게 조정. 기존 저장 돈/장비/열린 광맥 보존.
- 카메라 기본32→22(동일 화면에서 약1.45배 확대), 범위12~48, 휠 위/아래, +/-/초기화. UI·텍스트 확대. 이름표와 분리된 화면 좌표 게이지로 채굴·가공·자동화의 %/남은초/출력대기 표시.
- 공유 AudioContext: 발걸음·채굴·가공·집기·투입·내려놓기·던지기·완료·설치·보상·해금·핑·발사·오류. 음량/음소거, 중복 응답·과거 이벤트 재생 방지.
- 126 테스트 및 1/2/4/6인 목표량 이동 봇 발사 성공. 판매0회, 추가 연습0회, 아이템/자금/위치 주입 없음. 실제 사람의 플레이 시간 검증 아님.
- QA 브라우저: v3.3.0, 새 작업장/재접속, 확대 버튼100→110%, 음량45%/거리20 설정, 1363×936 패널 넘침 수정 확인. WebGL2 미지원: 실제 GPU/FPS/휠에 따른 3D 영상/게이지 외관/음향 청음은 미검증.
- 상세 docs/carry/EXPERIENCE_3_3.md 및 evidence/progression-3.3-campaign-*.json. 기존 Site와 GitHub draft PR #1에 게시; main 미병합. 최신 원격 HEAD로 이어갈 것.

---

# 최신 변경 — 3.2.0 (2026-11-17 KST)

사용자 요청: 작업대 설치 후 정지 수정, 진행 전 과정 재검증, 새 방 0원·최소 기본 장비·철광석만 시작, 이후 광맥 단계 해금.

정지 원인 재현: 최하위 작업대의 Group에는 Sprite 이름표가 있다. 기존 view.ts가 카메라 없는 Raycaster로 그룹을 재귀 검사하면서 Sprite.raycast에서 matrixWorld null 예외를 매 프레임 발생시켜 렌더링에 도달하지 못했다. occlusionMaterials가 실제 Mesh만 비재귀 검사하고 기존 평행 정사영 occlusionRay를 사용한다. drawFrame 실패 시 오류와 3D 재시작을 표시하며 반복 실패 루프는 중단한다. 재현 시험 및 6종 기본 설비의 120프레임 회전·제거 검증 추가.

새 캠페인은 1~6인 모두 0코인·starter-bench 최하위 1대(-10,-7)·철광석만 해금. 구리(20코인/12XP) → 규석(45/30) → 석탄(70/65), 앞 광맥 필요. 비용은 기존 인원 보정 적용, XP는 소모하지 않는다. UNLOCK_VEIN은 서버가 검증하며 중복 소비 방지, 해금 위치에 작업자/물건/설비가 있으면 안전하게 거부한다. 잠긴 광맥은 모델·이름표·벽·채굴 대상·자동 채굴·관련 레시피에서 제외. 광맥 개발 UI에 조건 표시.

저장 규칙 quarry-3.2.0. 이전 알려진 규칙의 저장은 기존 자금·기계·진행·광맥 개방을 보존한다. 기존 방을 0원으로 초기화하거나 무료 작업대를 다시 지급하지 않는다. 새 조건은 새 협동 작업장 생성 시 적용. 신규 3D 모델 생성/유료 사용 없음.

검증: 설계/119개 테스트/타입/웹 빌드. HTTP Worker+실제 SQLite에서 새 시작·해금·중복요청·재접속·회수/재설치 저장을 검증. 1/2/4/6인 목표량 단일 이동 봇은 0자금·기본 작업대에서 실제 이동·채굴·판매·해금·추가 설치·강화·조립·발사까지 성공(아이템/자금/위치 주입 없음). 이는 사람의 협동 플레이 시간이나 GPU 테스트가 아님. 상세 docs/carry/PROGRESSION_3_2.md와 evidence/progression-3.2-campaign-*.json.

로비 v3.2.0/0코인/작업대1대 안내 확인. QA 브라우저 WebGL2 미지원 계속: GPU/FPS 미검증. 기존 Site appgprj_6afbab1bae9c8191a78a6b95da2ba905와 GitHub nakk3975/ASTRA_START 기존 draft PR #1에 갱신; 소유자 전용 유지, main 병합 없음. 다음 작업자는 Site/PR head로 최신 게시 상태 확인.

# 최신 변경 — 3.1.2 (2026-11-17 KST)

이동 직후 E 대상·HUD·기계 패널·설치 고스트·C 재중앙은 MotionSmoother.player의 표시 위치/방향을 사용한다. 서버 좌표는 클라이언트 값으로 덮어쓰지 않는다. checkpoint로 행동 직전 이동을 봉인하고 actionBarriers/actionAfter로 해당 이동을 서버가 적용한 뒤 명령을 한 번 처리한다. 미적용 시 영수증·소비 없이 재시도하며 재접속 세대가 바뀌면 이전 barrier만 해제하고 명령 ID는 유지한다. 걷기 동작은 실제 표시 변위로 판정한다.

미전송 구간을 합칠 때 tailOrigin에서 전체 구간을 다시 적분해 서버와 같은 벽 충돌·미끄러짐 결과를 얻는다. 기존 벽 모서리 0.6~1.1cm 오차 사례와 경사로 상·하행을 60/144/240/360Hz + 300ms 응답 지연으로 검증: 정지 후 변위 및 최종 서버 오차 1e-7 미만. 모든 지형·통신 상황에 대한 보장은 아니다.

package.json 버전 3.1.2를 공통 APP_VERSION으로 로비·메뉴·게시 서버 health에 반영. 저장 규칙 quarry-3.1.0 및 기존 자금/재료/레시피/광맥/모델 유지. 신규 모델 생성 없음.

검증: npm run check(설계 검사·107개 테스트·TypeScript/Vite), npm run test:carry:network(6개 실제 WS 클라이언트·PostgreSQL, 분할 이동 뒤 행동·중복 제거·프로세스 재시작) 통과. 검증 보고 docs/carry/INTERACTION_3_1_2.md 및 evidence/interaction-verification.json. 원격 QA 브라우저 WebGL2 미지원으로 GPU 외관/FPS/사람의 체감은 미검증.

배포 대상: 기존 소유자 전용 Site appgprj_6afbab1bae9c8191a78a6b95da2ba905 (https://scrap-to-orbit-model-review.dsfs3975.chatgpt.site). 기존 GitHub draft PR #1에 소스 동기화; main 미병합. 실행 환경 단절은 복구되었다. 다음 작업자는 Site의 live 버전과 PR head를 조회해 이 소스의 게시 상태를 확인할 것. 화면 v3.1.2 및 /api/health의 build가 적용 버전을 표시한다.

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
