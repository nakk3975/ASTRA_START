# 고철에서 우주까지 — 작업 재개 기준

2026-11-17 KST. 저장소 nakk3975/ASTRA_START, 브랜치 codex/resume-meshy-pilot-20261117, PR https://github.com/nakk3975/ASTRA_START/pull/1. main 병합 전입니다. 최신 사용자 수정과 실제 코드는 이 브랜치를 기준으로 합니다.

최신 규칙 mining-2.1.0: 광맥 채굴, 다단 가공 보상, 1→2→3 운반량, 자동 채굴/컨베이어/크레인/설치기. packages/carry-core가 새 규칙, apps/web/src/carry가 새 게임 화면, apps/server/src/carry는 WS/PG, apps/sites-worker는 HTTP/D1입니다. 기존 game-core/v1은 /legacy로 보존했습니다.

사람 작업자로 교체 완료. Geometry task 01a1e7db-322c-743e-890c-995f361092a4, texture task 01a1e7de-f944-744d-b8e6-997c3f91418c. 추가15크레딧, 잔액2444 확인. 이전26종 생성까지 누적641크레딧, 이번 포함656. 두 작업 성공, 유료 생성 반복 금지. 18본 로컬 리깅/5클립/LOD0·1 실제 게임 manifest 연결. 공급자 license 필드 부재 상태 유지.

78테스트/설계/TypeScript/빌드 PASS. 실제6개 WS클라이언트+PG 재시작 PASS. 실제맵 26설비 광맥→주괴→철판→경사로→설치 자동화 PASS. 이동 봇 실제규칙 완주2420초(시뮬레이션), 첫설치75초/자동화상자434초. 상세 docs/carry/IMPLEMENTATION.md와 evidence 참조.

GPU 검증 BLOCKED: cloud browser GL_VENDOR=Disabled, GL_RENDERER=Disabled. 인간의 실제 3D 게임 플레이, 모델 관절 변형/가림/조립 외관, FPS/저사양 및 정상시간6인 완주 미검증. GPU 실패를 3D 성공으로 보고하지 말 것. WebGL 없이 미리보기 이미지는 /asset-review에서 확인 가능.

Sites ID appgprj_6afbab1bae9c8191a78a6b95da2ba905. https://scrap-to-orbit-model-review.dsfs3975.chatgpt.site. 소유자 전용 유지. v5 실제 게임 Worker+D1 배포 성공. 소스 73f711e0822d4591efc87b870451d2a025ad795e. 운영 API에서 방 생성·6인 참가·이동·7번째 거부·이어하기까지 확인. 클라우드 브라우저는 사이트 로그인 화면이므로 운영 UI 직접 검수는 별도. 세부 publication.json / production-smoke.json 참조. 새로운 Site를 만들지 말 것. 친구접속을 위해 임의공개하지 말 것. .sites-checkout의 source는 이 저장소 복사본이며 라이브러리에 저장소를 중복 업로드하지 않는다.

재현: npm ci, npm run check, npm run test:carry:network, npm run test:carry:campaign. Node24.22.1. 최종 게시 증거: docs/carry/evidence/publication.json.
