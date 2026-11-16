# 구현 추적표

원본 `design/`은 입력 패키지를 보존한다. 실행 데이터는 `packages/content`에서 이 원본 JSON을 직접 읽는다. 경제 수치 변경 없음.

| 단계 | 기능 / 명령 | 코드 경계 | 증거 |
|---|---|---|---|
| P0 | 데이터 버전, canonical hash, 결정적 시간, 검증 | content / protocol / game-core | design 검산, core 테스트 |
| P1 | MOVE_INPUT, WORK_START/HOLD/STOP, TRANSFER_ITEM, M1 | core / server / web | 실제 브라우저 및 소켓 시험 |
| P2 | 10 레시피, 6 단계, 전력, 설치·이동·강화·철거 | core | 불변식 및 전이 시험 |
| P3 | CREATE/DRAIN/EDIT/REMOVE_LINK, 실제 cargo, 자동 수거 | core logistics | 예약·분배·도착 시험 |
| P4 | guest, room actor, durable ACK, journal, snapshot, lease | server / migrations | PostgreSQL 및 6 연결 시험 |
| P5 | 로비, Three.js 월드, 개인 패널, 가로 터치, 세로 보기 | web | 화면별 QA |
| P6 | 보안, 부하, 발사 완주, 재현·배포 문서 | tests / scripts / docs | acceptance_tests.csv |

각 CSV 행은 전체 시나리오를 직접 수행한 경우만 PASS로 변경한다. 부분 시험, 가속 코어 모형, 실제 WebSocket 봇, 브라우저 수동 조작은 구분한다.

## 단계 게이트

표의 증거 열은 구현에 대응하는 검증 종류이다. 모든 단계 게이트가 통과했다는 뜻이 아니다. 최신 실제 결과와 미실행 범위는 [QA 보고서](qa/REPORT.md)의 단계별 상태를 따른다. P6 및 정상 시간 1인/6인 온라인 완주 게이트는 미완료다.
