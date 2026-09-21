# 군중 알고리즘 등록 및 실행 계약

현재 실행 가능한 프리셋은 Legacy · 방향별 유체 군중 하나입니다.
B0/B1/R/Q/D의 A*, ORCA, Boids, 속도 샘플링, 대형·슬롯 배정, 통로 대기열,
밀도 감속 파이프라인 구현은 제거했습니다. Legacy가 사용하는 FlowField,
CrowdField, CrowdFlowSolver, CrowdMovementSolver와 SpatialHash는 유지합니다.

## 새 알고리즘 추가

1. 별도 모듈에서 src/algorithms/lab/pipeline.ts의 LabPipeline을 구현합니다.
   공유 LabWorld의 상태·반경·목표·지형을 사용하며 step은 current를 읽고 next를 작성합니다.
   preferredX/Y, 경로 방향 sample, targets, available, navigators, stats를 제공해야 합니다.
   targets는 유닛별 목적지이며 available은 유효 목적지 여부입니다.
   Legacy 이외의 구현은 자체 경로 생성과 도착 판정을 담당합니다.
2. registry.ts의 PRESETS에 고유 id, 표시 이름, 설명, 한계, options와 createPipeline을 등록합니다.
   options.destination은 exit 또는 slots이며 결과 감사와 렌더링의 도착자 취급에 사용됩니다.
   Legacy만 팩토리 없이 기존 내장 solver를 사용합니다.
3. 설정 변경을 지원하면 validateOptions를 제공합니다. 개별 목표를 지원하는 구현은
   supportsIndividualGoals를 지정하고 팩토리에 전달된 overrides를 처리합니다.
   설정 UI는 알고리즘에 맞게 추가합니다. 삭제된 구현의 모듈 선택지는 노출하지 않습니다.
4. 초기화, 목표 명령, 지형 변경 시 팩토리를 호출합니다. 이전 상태가 필요하면 previous를 사용합니다.
   누적 경로·field·통과 카운터는 CrowdSimulation이 보존하므로 중복 누적하지 않습니다.
   매 step의 이동·대기·도착·접촉 수와 pass 시간을 구현에서 기록합니다.
5. 동일 맵·seed·명령으로 Legacy와 비교하고 새 구현에 필요한 검증을 추가합니다.

선택 목록과 비교 버튼 개수는 PRESETS로 생성됩니다. main.ts의 순차 비교와
scripts/measure-lab.ts의 기본 실행 목록도 이 레지스트리를 사용합니다.
LabRecorder의 공통 결과 스키마, JSON 내보내기, 독립 기하 감사와 시나리오 명령 재생을 유지합니다.
새 프리셋을 추가할 때 UI나 CLI에 별도 프리셋 목록을 복제할 필요가 없습니다.

## 현재 검증과 과거 기록

기존 tests/simulation/legacy-baseline.test.ts는 평지·코너·혼합 크기에서
초기화, 이동, 목표 변경, 재초기화의 회전 제한 적용 후 해시를 검증합니다.
브라우저 algorithm-lab.spec.ts는 레지스트리 기반 선택, 실행, 비교, 저장·내보내기를 검증합니다.

baselines/의 JSON 및 소스 스냅샷과 lab-measurements.md, corner-regression.md는
제거 전 알고리즘의 역사적 측정 자료입니다. 현재 구현 목록이나 실행 가이드로 사용하지 않습니다.
