# 자산과 의존성

- 월드 건물, 캐릭터, 로켓, 자원, 경로, 화물: 이 저장소의 Three.js/Canvas 도형 코드로 생성. 외부 게임 자산 사용 없음.
- 아이콘: App.tsx의 자체 SVG path. 효과음: Web Audio oscillator로 생성.
- 폰트: Google Fonts의 Noto Sans KR / DM Sans(각 SIL Open Font License). 네트워크 사용 불가 시 시스템 sans-serif로 대체. 폰트 파일을 저장소에 재배포하지 않음.
- React, Three.js, Colyseus, Express, Zod, node-postgres, Vite, TypeScript, tsx: 각 npm 배포본의 LICENSE 참조. `package-lock.json`에 버전과 integrity 고정.
- embedded-postgres 및 번들 PostgreSQL: 로컬 개발 편의 도구. 운영에서는 DATABASE_URL로 외부 PostgreSQL 사용. 각 패키지의 라이선스 포함.
- 설계 파일: 사용자가 제공한 원본을 design/에 변경 없이 보존. 프로젝트 전체의 오픈소스 라이선스는 사용자가 선택하기 전까지 새로 부여하지 않음.
