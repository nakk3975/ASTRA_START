# 설계 충돌과 해석

- HTTP 장은 `/api/rooms/:id/join-ticket` 60초, 보안 장은 `/api/ws-ticket` 30초로 상충한다. 실행 수치 우선 규칙에 따라 runtime_v1.json의 join_ticket_ttl=60000과 방별 endpoint를 사용한다. 1회성·guest/room 바인딩은 유지한다.
- 튜토리얼 T3의 완료 사건이 본문 두 곳에서 제작 완료/수거로 다르다. UI는 제작 완료 후 수거 안내를 보여주며 수거까지 안내를 유지한다. 보상 없음.
- 배포 대상은 사용자 지정 GitHub ASTRA_START이며, Node/Colyseus를 정적 Sites로 대체하지 않는다. Render용 실행 구성은 저장소에 제공한다.
