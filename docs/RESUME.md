# 고철에서 우주까지 — 작업 재개 기준

2026-11-17 KST. 저장소 nakk3975/ASTRA_START, 브랜치 codex/resume-meshy-pilot-20261117, PR https://github.com/nakk3975/ASTRA_START/pull/1. main 병합 전. 최신 코드는 이 브랜치이며 현재 규칙은 **workshop-3.0.0**입니다.

최신 요청 반영: 이동 예측/서버 보정/원격 보간, 경사로 경계 멈춤 수정. 빈 공방+시작80코인, 40코인 작업대 상자 구매·직접 설치. 운반1→8, 이속5단계+30%, 짐운반·도구·레일·가공·자동화 분기, 기계4등급, 광맥각5등급. 가공XP/판매·납품코인 분리. 기존 저장·설비·자금 보존 마이그레이션. 상세 docs/carry/GROWTH_3_0.md.

사람 캐릭터4종: worker + worker-engineer/mechanic/pilot. 이번3종 생성45크레딧, 확인잔액2399. 성공작 재생성 금지. 18본/5클립/2LOD, 29종58GLB. 출처/작업ID는 docs/carry/character-generation-v2.json. 공급자 license 필드 부재 상태 유지.

검증: 89테스트·설계·타입·빌드 PASS, 실제6개 WS+PG 재시작 PASS, 1/2/4/6인 목표량 단일 이동봇 구매부터 발사까지 PASS. 사람이 협동한 플레이 시간은 아님. 증거 docs/carry/evidence/growth-*.json/jpg. GPU는 원격브라우저 WebGL2 미지원으로 미검증. UI구매/자금/캐릭터 변경은 확인. GPU/FPS가 검증됐다고 말하지 말 것.

Sites ID appgprj_6afbab1bae9c8191a78a6b95da2ba905, https://scrap-to-orbit-model-review.dsfs3975.chatgpt.site. 기존 소유자전용 범위 유지. 새 Site를 만들거나 임의공개하지 말 것. .sites-checkout/source는 저장소 복사본. 최신 게시 결과는 growth-publication.json 및 growth-production-smoke.json 참조(이전 publication.json/production-smoke.json은 v5 기록). 신규 변경은 helper로 정확한 source를 push/package한 뒤 기존 Site에 게시.

packages/carry-core는 공통 규칙, apps/web/src/carry는 새게임, apps/server/src/carry는 WS+PG, apps/sites-worker는 HTTP+D1. /legacy는 이전 v1을 별도 보존. npm run check, npm run test:carry:network, npm run test:carry:campaign, node --import tsx tests/carry-campaign.ts 2/4/6. Node24.22.1.
