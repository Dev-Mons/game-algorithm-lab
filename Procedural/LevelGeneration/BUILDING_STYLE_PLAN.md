# Banded facade 계약

현재 스타일은 `format: banded-facade-v1`, shop/office 버전4입니다. 고정 층 목록이나 중앙 입구 선택 정책은 지원하지 않습니다. 실제 전체 정의를 현재 문서에 저장하며 정의를 바꾼 편집도 저장·복원·Undo/Redo 대상입니다.

## 수직 구간

컴포넌트 최저 Y를 datum으로 하고 전체 높이에서 base/body/crown 정수 구간을 계산합니다. 용도별 base 비율과 crown 비율은 permille이며 `(H*ratio+500)/1000`의 내림으로 반올림합니다. 1~3셀 건물은 base1/body나머지/crown0으로 축약합니다. 긴 건물은 설정의 최소·최대와 body 유지 조건으로 clamp합니다. override도 같은 유효성 검사를 받습니다.

구간 경계는 건물 전체의 절대 Y에 맞추고 부분 낮은 지붕에는 실제 local-cap을 둡니다. 벽면마다 구간을 다시 계산하지 않습니다. 보존된 design.anchor를 기저 u축에 투영해 반복 family의 phase를 정합니다. 부피의 앞쪽을 잘라도 먼 외벽이 재추첨되지 않습니다.

## 문법과 형상

`alignedFamilies`는 각 band의 패턴과 동일 주기를 지정합니다. 연결 창문 그룹은 single 또는 완전한 left/middle/right 조합이어야 하며 잘린 그룹을 출력하지 않습니다. 실제 run 끝과 band의 foot/repeat/head/single 역할에 따라 rowAsset을 사용합니다.

base/body/crown은 실제 개구부, 기둥, 하단 받침과 상단 띠 형상을 가집니다. 선택 가능한 asset의 정수 bounds는 사전 등록됩니다. 출입구는 EntrancePlan의 faceIds와 역할을 그대로 소비하며 단일/쌍문 개구부 내부에 프레임이나 문턱을 채우지 않습니다.

마감은 actual boundary를 따라 straight/cut/convex/concave terminal을 한 소유자만 생성합니다. raw voxel과 기존 예약을 검증하고 명시된 같은 조립 접합부만 공유합니다. 충돌한 선택 마감은 사유와 함께 생략하며 필수 구조를 제거하지 않습니다.

## 검증

`tests/vertical-design.test.ts`, `tests/building-style.test.ts`, `tests/banded-facade-assets.test.ts`, `tests/entrances.test.ts`와 `e2e/building-style.spec.ts`가 비율·정렬·연결 그룹·실제 개구부·접합·접근·저장 이력을 검증합니다. 과거 출력 스냅샷은 완료 기준이 아닙니다.
