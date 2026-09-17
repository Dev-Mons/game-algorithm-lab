# 현재 환경 생성 구조

실행 명세는 GitHub #16 및 #17~#27입니다. `generateDocument`가 schema5 문서의 유일한 실행 진입점입니다. Grid 분석·타일 선택 함수는 공통 실행의 하위 연산이며 별도의 문서 생성 모드가 아닙니다.

1. 현재 문서/등록 definition/adapter 검증과 결정적 외피 분석.
2. 전체 컴포넌트 수직 구간 및 immutable preflight envelope.
3. 실제 지지면·고정 solid·공공 차량/보행 공간.
4. 보호 예산을 배분한 주차 gate/차로/인증 crossing.
5. 모든 일반 건물 입구의 공통 landing/보행 계획.
6. 선행 예약을 보존한 주차 구획의 차량 왕복·후면 보행 증명.
7. 공통 수직/출입구 계획을 소비하는 필수 구조, 문맥 시설, 충돌 검사된 선택 마감.
8. coverage/envelope 검증과 단일 Viewer sync, 수락 상태/이력 publication.

모든 후속 단계는 원본과 선행 계획을 읽으며 mesh나 생성 시설을 상위 입력으로 되먹이지 않습니다. 형식/공간 계약 오류에서는 마지막 수락 상태를 유지합니다. 정상적인 공간 부족·NO_ROAD·partial은 입력과 사유를 남깁니다.

캐시는 64항목/16MiB FIFO 한도를 공유하며 key와 snapshot의 UTF-16 JSON 크기 추정치를 포함합니다. 실행 소유의 읽기 전용 snapshot은 깊게 동결한 뒤 재사용하고, 예약 book과 외부 가변 반환은 안전하게 복제합니다. 현재 입력 검증, 외피, 실제 소비하는 geometry 문맥과 주차 계획을 구분합니다. Preflight는 cache hit에서도 실행하며 현재 Trace는 현재 계획에서 조립합니다. 계측과 실제 실행 비용은 결정적 저장/결과 밖에 둡니다.

상세 계약은 [포팅 문서](PORTING_CONTRACT.md), [스타일 문서](BUILDING_STYLE_PLAN.md), [진행·검증 기록](ENVIRONMENT_IMPLEMENTATION.md)을 따릅니다.
