# 고철로 우주까지 — 이어서 작업하기

기준: 2026-11-17 KST. 저장소 `nakk3975/ASTRA_START`, 개발 브랜치 `codex/resume-meshy-pilot-20261117`, PR https://github.com/nakk3975/ASTRA_START/pull/1. main에 합치지는 않았다. 오래된 ZIP이나 다른 작업 폴더로 덮어쓰지 않는다.

## 최신 작업

- 사용자가 “이동이 안 된다 / 그래픽 가속을 켰는데도 안 된다 / 나머지 모델도 생성” 요청. 이전 첫 3종 검수 뒤 생성 제한보다 최신 생성 요청을 우선 적용했다.
- 추가 23종 Meshy 생성 성공. 기존 3종 포함 26종·LOD0/1 GLB 52개·미리보기 26개. task ID, 파일 hash, 삼각형, 텍스처는 shipping manifest에 있다. 유료 생성 중복 실행 금지.
- 신규 비용 552 크레딧, 잔액 3011 → 2459 확인. 기존 89와 합산 641. 공급자 license 응답이 없어 UNVERIFIED 유지.
- /asset-review에 WASD/방향키/터치 버튼 이동, 이동 시 걷기, 모델 선택, 크기에 맞는 이동 장애물, 리셋 추가. 게임 WorldView에도 26종이 자동 연결된다. 서버/경제/지도 변경 없음.
- 운반 포드가 이미 0.32×0.24×0.42 타일인데 한 번 더 0.3배 축소하던 표현 오류 제거.
- WebGL 생성 실패 사유를 표시하고 powerPreference를 default로 변경. 실패 시 이동/확인 기록은 비활성화, 모델 미리보기는 제공.

## 현재 제한

원격 브라우저는 사용자 가속 옵션 변경 후에도 `GL_VENDOR=Disabled, GL_RENDERER=Disabled`, `BindToCurrentSequence failed`를 반환했다. 실제 WebGL 렌더링/키보드 이동/FPS/조립 외관 검수는 여전히 BLOCKED. 화면이 실패한 상태를 성공으로 보고하지 않는다. 브라우저 내부 설정 URL은 자동화 접근 정책으로 직접 열 수 없었으며 우회하지 않았다.

비공개 링크 https://scrap-to-orbit-model-review.dsfs3975.chatgpt.site 는 모델 둘러보기·이동 연습 전용이며, 온라인 협동 게임 서버 배포가 아니다. WebGL이 제공되는 사용자 기기에서 열어야 3D 이동을 확인할 수 있다.

## 검증과 다음 작업

58개 단위 시험, 설계 검증, TypeScript, 게임/검수 빌드 통과. 전체 GLB 52개를 실제 로더 경로로 읽고 hash/예산/리깅/클립 검증. 브라우저에서 모델 26개 선택 목록, 새 로켓 엔진 이미지 표시, 오류 상세, 재시도 후 동일 WebGL 제한 및 이동 비활성화 확인.

11종 LOD1은 UV/normal seam 때문에 표준 단순화로 예산에 도달하지 못해 Meshopt Permissive로 로컬 단순화했다. 추가 생성 비용은 없으며, 실제 게임 외관 확인은 필요하다. `docs/qa/evidence/all-models-generation.json` 및 manifest 참조.

다음: GPU 브라우저에서 26종 두 품질/세 해상도/시설 방향, 다섯 작업자 동작/6명 독립 재생/실제 이동/가림/로켓 조립을 검수. 정상 속도 1인·6인 완주, 부하·저사양 성능·최종 인수 160항목은 아직 남아 있다. 이전 가속 소켓 완주와 실제 브라우저 완주를 구분한다.

재현: Node 24.22.1, `npm ci`, `npm run check`, `npm run build:review`. `npm run dev`는 비운영에서 DATABASE_URL 미지정 시 `.local/postgres`를 자동 초기화한다.
