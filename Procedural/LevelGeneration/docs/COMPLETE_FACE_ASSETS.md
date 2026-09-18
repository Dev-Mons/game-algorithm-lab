# 완성형 면 에셋 계약

일반 건물의 벽·지붕·테라스·밑면은 **면 하나 = 실제 `THREE.Mesh` 객체 하나**다. 벽 본체, 프레임, 유리, 옥상 난간, 채택된 띠·상단·코너 마감을 같은 geometry에 포함한다. 자식 Mesh나 면을 묶는 InstancedMesh는 사용하지 않는다. geometry와 material은 같은 에셋끼리 공유한다. 한 객체의 재질 슬롯은 여러 draw call을 사용할 수 있다.

## 선택과 배치

1. 기존 facade 패턴·수직 구간·출입구 계획이 기본 타일과 팔레트를 선택한다. 옥상 난간은 수직 외벽의 기본 에셋에 포함되며 수평 지붕으로 옮기지 않는다.
2. `src/core/facade-trims.ts`가 기존 월드 경계 소유 규칙으로 straight/cut/convex/concave 마감을 선택하고 raw voxel·예약·envelope를 검사한다. 코너는 결정적인 한 호스트 면만 소유한다. 충돌 시 기존과 같이 해당 마감이 없는 고정 변형을 선택하며, 사유를 decision trace에 남긴다.
3. `src/core/complete-face-assets.ts`의 유한한 `FACE_FINISH_PROFILES`에서 완성형 키 `face-v1|<baseAssetKey>|<finishProfile>`를 선택한다. 치수·Grid·배치 행렬은 에셋 선택 계약에 들어가지 않는다. 마감 부품의 임의 좌표, 크기 조정, 잘라내기는 지원하지 않는다.
4. 파생 `Placement.faceAssetKey`는 완성형 에셋을, `finishIds`는 그 면이 소유하는 예약/결정 ID를 가리킨다. 별도 마감 render module은 출력하지 않는다. 예약의 `attachment` 종류와 실행 단계명은 공간 계획의 기존 의미로 유지한다.
5. `src/face-mesh.ts`는 그 키의 geometry와 팔레트 재질로 Mesh 하나를 만들고 면 중심·기저 회전만 적용한다. `userData.faceId`를 통해 유리나 돌출 코너를 눌러도 호스트 면을 선택한다. 선택/분석 오버레이와 독립 시설물은 이 외피 객체 수에 포함하지 않는다.

`faceAssetBounds()`는 완성형 키의 등록된 기본 면/마감 bounds를 합친 local bounds를 반환한다. 공간 검증은 기본 면의 required envelope와 마감의 deferred envelope 및 실제 예약 box들을 각각 사용한다. L자 코너의 전체 AABB를 solid로 예약해 빈 부분까지 막지 않는다. 마감 배치는 호스트와 동일 위치·방향이어야 한다.

## Blender 에셋 교체 지점

`src/crafted-geometry.ts`의 `buildCraftedGeometry(completeKey)`가 프로토타입 공급 경계다. 현재 데모는 고정 카탈로그 규격을 코드로 제작하며, 처음 사용하는 **에셋 키당 한 번** 단일 BufferGeometry로 준비하고 캐시한다. 볼륨이나 배치마다 조각을 합성·변형하지 않는다. 추후 이 경계를 완성형 키 → Blender에서 미리 제작한 단일 Mesh의 geometry 조회로 교체한다. 각 finish profile까지 포함한 완성형 모델이 필요하다. 런타임에 Blender 벽에 별도 마감을 덧붙이는 계약이 아니다.

- 로컬 좌표: 면 중심 pivot, U/V 범위 기본 ±0.5, +N 바깥쪽. 1셀 = 1단위, Box16은 1/16 단위다.
- 재질 슬롯: `0` 본체, `1` 프레임·필수 마감·난간, `2` 유리. 모든 삼각형은 한 슬롯에 속한다.
- 연결 창문의 좌우 경계, 출입구 aperture, 마감 끝점, 옥상 난간 높이와 등록된 bounds를 유지한다. 내보낸 실제 geometry의 bounds도 같은 검증을 통과해야 한다.
- 원본 문서에는 기존 타일/스타일/입력만 저장한다. 완성형 키와 마감 소유는 재생성하므로 기존 schema/catalog 버전을 바꾸지 않는다. Inspector에는 기본 타일과 완성형 키를 함께 표시한다.

현재 수평 roof/paving/soffit은 기존 단일 평면 형태를 유지한다. 개방형 주차장 건물의 슬래브·기둥, 도로·지상 주차장·식생·독립 시설물은 기존 경로를 유지한다. 45도·마름모·라운드 코너, Blender 파일 제작·임포터는 이번 구현 범위 밖이다.

## 회귀 검증

`tests/complete-faces.test.ts`는 실제 단일 Mesh, geometry 공유, 유리/코너 ray hit의 면 소유, 통합 형상 bounds, 예약 소유, 저장·복원의 결정론을 검증한다. 기존 접합·창문·옥상 테스트는 통합 geometry의 재질 그룹을 검사한다. `e2e/complete-faces.ts`는 실제 Viewer 객체 목록에서 외피 수·고유 면 수·추가 객체/자식/인스턴싱 여부를 검사하며 상가형 갤러리, 업무형 편집/Undo/Redo/복원, 두 스타일의 Setback 장면에서 사용한다.
