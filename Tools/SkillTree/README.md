# Skill Tree Studio

언리얼 UMG 스킬 트리용 노드 위치·연결·정보를 시각적으로 제작하고 DataTable JSON/CSV로 내보내는 독립 웹 도구입니다. 작은 아이콘 타일과 상하좌우·대각선 직선 연결로 게임형 스킬 트리를 제작합니다. 서버나 언리얼 실행 의존성 없이 브라우저에서 편집합니다. 구현 범위는 DataTable 추출과 언리얼용 Row Struct·규칙 계산 C++ 참조까지이며, UMG 위젯 생성과 투자 상태 저장은 게임에서 구현합니다.

## 실행

Node.js 22.12 이상에서 이 디렉터리를 기준으로 실행합니다.

Windows에서는 [run.bat](run.bat)을 더블클릭하면 됩니다. 첫 실행에 필요한 의존성을 자동 설치하고 브라우저를 엽니다. 기본 주소는 [http://127.0.0.1:4191](http://127.0.0.1:4191)이며, 같은 폴더의 서버가 이미 실행 중이면 해당 서버를 재사용합니다. 다른 프로그램이 포트를 사용하면 다음 빈 포트로 실행하고 창에 실제 주소를 표시합니다. 새로 서버를 실행한 창은 사용하는 동안 열어 두고, 종료하려면 `Ctrl+C`를 누릅니다. Node.js가 없거나 실행에 실패하면 창에 오류를 표시합니다.

`run.bat --port=4191`으로 시작 포트를 지정하거나 `run.bat --no-open`으로 브라우저 자동 열기를 끌 수 있습니다. 시작 포트부터 최대 20개를 확인합니다. 자동 저장은 브라우저 주소별로 구분되므로 포트가 바뀌면 **파일 → 열기**로 별도 저장한 작업 파일을 불러오세요.

터미널에서 직접 실행하려면:

```powershell
npm install
npm run dev
```

[http://127.0.0.1:4191](http://127.0.0.1:4191)을 엽니다. 첫 실행에는 머신건 스킬 4종이 표시되며, 저장된 작업이 있으면 그 작업을 복원합니다. **파일 → 머신건 스킬**로 기본 구성을 다시 열 수 있습니다. `npm run build`는 정적 배포용 `dist/`를 생성합니다. 외부 폰트·CDN·서비스가 필요하지 않습니다.

## 제작 흐름

1. 상단 **설정 → 스킬 프리셋 → 새 프리셋 정의**에서 스킬 ID·이름·설명·아이콘·디자인·최대 투자 횟수·비용·효과·설명 표시 방식·추가 데이터를 정의합니다. **속성 적용** 또는 **완료**로 반영합니다. 머신건 4종은 기본 프리셋으로 제공됩니다.
2. 프리셋 카드를 **캔버스로 드래그**하거나 카드의 **+** 버튼을 눌러 배치합니다. **선택 스킬 배치** / `N` / 빈 캔버스 더블클릭은 현재 선택한 프리셋을 배치합니다. 같은 프리셋을 여러 번 배치할 수 있으며 각 배치는 고유한 노드 ID를 가집니다.
3. 노드 **본체를 드래그**해 위치를 바꿉니다. 선택·연결 모드 전환은 없습니다. 우측 **배치 속성**에서는 노드 ID·사용할 프리셋·X/Y·해금 조건과 선행 연결을 수정합니다. 위치·해금 조건·선행 연결은 각 배치에 독립적으로 저장됩니다. 왼쪽 **배치된 노드**를 펼치면 목록으로 선택할 수 있습니다.
4. 선행 노드 A의 우측 상단 **보라색 + 핀**을 드래그해 후행 노드 B에 놓습니다. 본체와 연결 핀을 구분해 이동과 연결을 바로 이어서 작업합니다. 우측 선행 노드 선택기로도 연결할 수 있습니다. 여러 선행 노드를 허용합니다.
5. 공통 스킬 속성을 바꾸려면 **설정 → 스킬 프리셋** 또는 우측 **프리셋 설정 ↗**을 누릅니다. 메인 화면의 카드는 배치할 스킬만 선택합니다. 설정을 닫으면 기존 노드 선택으로 돌아옵니다. 변경 사항은 같은 `SkillId`를 참조하는 모든 배치에 반영되며, 배치 ID·좌표·연결은 유지됩니다. 프리셋 ID를 바꾸면 참조도 갱신됩니다. 배치 중인 프리셋은 삭제할 수 없고, 노드를 지워도 프리셋은 유지됩니다.
6. **작업 저장**으로 프리셋과 배치를 함께 `.skilltree.json`에 보관합니다. 아직 배치하지 않은 프리셋도 보존됩니다. **파일** 메뉴에서 열기·새 프로젝트·예제를 선택합니다. **새 프로젝트**는 배치만 비우고 현재 프리셋 라이브러리와 효과 대상 목록을 유지합니다. 머신건/아틀라스 예제는 예제 프리셋과 배치로 프로젝트를 교체합니다.
7. **JSON 내보내기**에서 언리얼 DataTable을 다운로드합니다. 기본값은 스킬 정의·배치·연결선·트리를 나눈 [분리 테이블](#언리얼-분리-테이블-권장)(JSON/CSV/ZIP)이고, 이전의 [단일 테이블](#단일-테이블-row-계약-이전-형식)도 선택할 수 있습니다. 좌표·연결선·깊이를 미리 계산하므로 언리얼에서 별도 JS 실행이 필요하지 않습니다.

다른 항목 선택·저장·내보내기 전에 유효한 속성 입력은 자동 적용됩니다. 설정 탭 전환이나 창 닫기(`Esc` 포함)도 입력한 속성과 효과 태그를 반영합니다. 잘못된 입력은 오류를 표시하고 전환을 막으며, **입력 취소**로 적용 전 입력만 되돌릴 수 있습니다. 이미 적용된 변경은 창을 닫은 뒤 실행 취소로 되돌립니다. 드래그로 배치할 때는 입력 중인 배치 속성을 먼저 적용하세요.

브라우저 localStorage에 적용된 작업을 자동 저장합니다. 브라우저/주소가 달라지거나 사이트 데이터를 지우면 복원되지 않으므로 작업 파일을 따로 보관하세요. 새 프로젝트·열기·예제 열기는 현재 작업을 교체하지만 같은 세션의 실행 취소로 복원할 수 있습니다. 자동 저장 실패 시 하단에 표시됩니다.

**머신건 스킬** 기본 구성은 공격력 증가(5회), 발사 속도 증가(5회), 사거리 증가(3회), 관통(1회)입니다. 횟수와 선행 연결은 편집 가능한 예제 기본값입니다. 공격력에서 발사 속도·사거리로 분기하고 두 스킬에서 관통으로 연결됩니다. 각 스킬의 횟수는 **설정 → 스킬 프리셋 → 최대 투자 횟수**에서 1 이상의 정수로 바꿀 수 있으며, 노드의 `×5`는 현재 투자 수가 아닌 **최대 허용 횟수**를 뜻합니다. JSON에는 기존 `MaxLevel` 필드로 저장하며 같은 프리셋의 모든 배치에 동일한 제한값을 적용합니다. 현재 투자 횟수·포인트 소비·실제 무기 효과 계산은 게임 런타임의 역할입니다.

**아틀라스 예제**는 52개 노드가 여러 방향으로 분기하는 편집 가능한 샘플입니다. 이름은 기본적으로 숨기며 마우스를 올리거나 하단 **이름 표시**로 확인합니다. 각 연결의 양 끝에는 **금색 가장자리 포인트**가 항상 표시됩니다. 시작 포인트를 다른 노드로 드래그하면 선행 노드를, 도착 포인트를 드래그하면 후행 노드를 변경합니다. **Alt+포인트 클릭**은 해당 연결 하나만 해제합니다. 새 연결·재연결·해제 모두 실행 취소할 수 있습니다.

빈 곳이나 캔버스 밖에 놓기, 드래그 중 `Esc`, 포인터 취소는 작업을 취소합니다. 기존 연결은 유효한 새 대상에 놓을 때만 교체되며 자기 자신·중복·순환 연결이 되면 오류를 표시하고 원래 연결을 유지합니다. 노드 본체를 클릭하면 선택하고 드래그하면 이동합니다. 새 연결은 + 핀에서만 시작합니다. 이동 중 `Esc`도 원래 위치로 되돌립니다.

연결선과 금색 포인트는 두 노드의 중심 방향을 따라 실제 모양의 **테두리**에 위치합니다. 미리보기 역시 시작 노드 가장자리에서 그려지며, 대상 노드 위에서는 그 노드의 가장자리로 맞춰집니다. 선택한 노드 주변의 연결에만 방향 화살표를 강조합니다. 연결선이 다른 노드를 관통하지 않도록 배치하는 것은 작성자의 책임이며 자동 우회 배선은 지원하지 않습니다.

하단에서 **판타지**(금색 선) / **네온**(밝은 외곽선) 보기와 **캔버스 넓게 보기**를 전환할 수 있습니다. 이 보기 설정은 편집 화면용이며 JSON에 저장되지 않습니다. 학습됨/잠김 같은 플레이 상태를 표시하는 기능은 아닙니다. 예전 형식의 작업·DataTable 파일도 열 수 있으며 좌표와 연결을 보존하고 새 디자인 필드를 기본값으로 채웁니다. 원래 좌표가 카드형 배치였다면 작은 타일 사이 간격은 직접 조절하세요.

| 조작 | 동작 |
| --- | --- |
| 빈 캔버스 드래그 / 마우스 중간·오른쪽 버튼 드래그 | 화면 이동 |
| 휠 / +, − 버튼 | 포인터 기준 확대·축소 / 화면 중앙 기준 확대·축소 |
| `F` | 전체 트리 보기 |
| `Esc` | 진행 중인 연결·이동 취소 / 선택 해제 및 적용 전 배치 입력 취소 |
| 노드 A의 보라색 + 핀 → 노드 B 드래그 | A를 선행 조건으로 하는 새 연결 생성 |
| 노드 본체 드래그 | 위치 이동 (다중 선택이면 선택한 노드를 함께 이동) |
| `Shift`+노드 클릭 / `Shift`+빈 캔버스 드래그 | 다중 선택 추가·제외 / 범위 선택 |
| `Ctrl+A` | 모든 노드 선택 |
| 방향키 / `Shift`+방향키 | 선택 노드를 그리드 한 칸(스냅 해제 시 1px) / 1px 이동 |
| `P` | 편집 ↔ 플레이테스트 전환 |
| 금색 가장자리 포인트 드래그 | 해당 끝점의 연결 노드 변경 |
| `Alt` + 가장자리 포인트 클릭 | 해당 연결 하나 해제 |
| `Delete` | 선택한 노드(다중 선택 포함) 또는 연결 삭제 |
| `Ctrl+Z` / `Ctrl+Shift+Z` 또는 `Ctrl+Y` | 실행 취소 / 다시 실행 (최대 100단계) |
| `Ctrl+D` | 같은 프리셋으로 배치 복제 (연결은 복제하지 않음) |
| `Ctrl+S` | 편집용 프로젝트 다운로드 |

텍스트 입력 중에는 브라우저의 텍스트 편집 단축키를 유지합니다. 노드 삭제는 연결도 삭제하고, ID 변경은 모든 연결의 참조를 갱신합니다. 적용 전 속성이 있을 때 툴바의 실행 취소는 먼저 그 입력을 취소합니다. 목록에서 선택하면 해당 노드가 화면 중앙으로 이동합니다. 연결선을 클릭해 선택하고 삭제하거나 우측 선행 목록의 ×로 해제할 수 있습니다.

## 트리 검사·다중 편집·플레이테스트

**검사**(캔버스 툴바)는 편집할 때마다 트리를 다시 검사합니다. 배지는 경고·오류 개수이며, 문제가 있는 노드에는 노란(경고)·빨간(오류) 점이 표시됩니다. 항목을 누르면 관련 노드를 강조하고 첫 노드로 이동합니다. 검사는 저장·내보내기를 막지 않습니다. 계산 참조: [diagnostics.ts](src/diagnostics.ts).

| 수준 | 검사 |
| --- | --- |
| 오류 | 트리 요구 포인트가 다른 노드를 모두 최대로 찍어도 도달할 수 없는 값 |
| 경고 | 노드 영역 겹침 · 연결선이 다른 노드를 지나감 · 연결이 하나도 없는 노드(노드가 2개 이상일 때) |
| 참고 | 선행 노드가 2개 미만인데 '선행 노드 중 하나' 조건 · 선행 요구 투자가 선행 노드 최대치를 넘음 · 효과와 기본 설명이 모두 빔 · 배치하지 않은 프리셋 |

여러 노드를 선택하면 우측 패널이 **정렬**(왼쪽·가로 중앙·오른쪽·위·세로 중앙·아래)과 **간격 균등**(3개 이상, 노드 중심 기준) 도구로 바뀝니다. 그룹 이동·정렬·방향키 이동·삭제는 각각 한 번의 실행 취소 단위입니다. 다중 선택 중 선택된 노드를 드래그 없이 클릭하면 그 노드만 선택합니다.

**플레이테스트**(툴바 또는 `P`)는 [분리 테이블 런타임 규칙](#런타임-규칙-skilltreerulesh)과 같은 계산으로 트리를 직접 찍어 봅니다. 노드를 클릭하면 1회 투자, `Shift`+클릭 또는 우클릭하면 1회 회수합니다. 잠김·투자 가능·투자 중·최대 투자 상태와 노드별 `현재/최대` 투자, 조건을 만족한 연결선이 표시됩니다. 우측 패널에서 보유 포인트(기본 20, **포인트 = 트리 완성**으로 전체 비용 설정), 투자할 수 없는 이유, 선행 조건 충족 현황, 다음 투자 설명 미리보기(미리보기 기본값 사용), 효과 대상별 합계를 확인합니다. 투자 상태는 세션 동안만 유지되며 프로젝트·자동 저장·내보내기에 들어가지 않습니다. 플레이테스트 중에는 노드 이동·연결·배치 같은 편집이 꺼지며, 프리셋을 배치하면 편집 모드로 돌아갑니다. 하단 상태 표시줄에는 최대 깊이와 트리 완성 포인트를 표시합니다.

## 프리셋 저장과 호환성

편집용 프로젝트의 `presets`는 공통 스킬 정의 목록입니다. 각 배치 노드는 `SkillId`로 정의를 참조하며, 기존 DataTable 호환을 위해 공통 속성 스냅샷도 함께 보관합니다. 편집기는 스냅샷과 정의의 일치 여부를 검사하므로 개별 배치의 공통 속성만 수동 수정한 파일은 거부합니다.

기존 프리셋 없는 프로젝트는 노드별 정의를 생성하면서 ID·좌표·연결·속성을 보존합니다. DataTable JSON을 다시 열면 같은 `SkillId`를 가진 Row는 하나의 프리셋으로 묶입니다. 같은 ID에 서로 다른 속성이 들어 있으면 오류로 처리합니다. DataTable 출력에는 미배치 프리셋이 없으므로 라이브러리 전체를 보관하려면 반드시 **작업 저장**을 사용하세요.

## 선택형 효과 설정과 동적 설명

프리셋의 **효과 설정**에서 다음 항목을 선택합니다. 프리셋에서는 등록된 태그를 선택하며 `{CurrentBonus}` 같은 설명 변수명을 직접 입력하지 않습니다. 태그 ID의 등록·수정은 **설정 → 효과 대상**에서 합니다.

| 항목 | 선택 / 입력 |
| --- | --- |
| 효과 대상 | 효과 없음 / `MachineGun.Damage` / `MachineGun.FireRate` / `MachineGun.Range` / `MachineGun.Pierce` |
| 적용 방식 | 고정값 증가 / 비율 증가 (%) — 기본 능력치 기준 |
| 1회 투자 증가량 | 숫자 입력 (±1,000,000 이내) |
| 설명 표시 방식 | 누적 증가량 + 이번 증가량 / 현재 능력치 + 이번 증가량 / 현재 능력치 → 다음 능력치 / 현재 투자 횟수 / 최대 투자 횟수 |

예를 들어 **MachineGun.Damage → 고정값 증가 → 1 → 누적 증가량 + 이번 증가량**으로 설정하면 공통 효과 대상 `MachineGun.Damage`와 올바른 FText 템플릿이 자동 생성됩니다. 속성 패널의 **설명 구성**은 선택한 문장의 구성 요소를 표시하며 플레이어 투자 상태를 시뮬레이션하지 않습니다. 실제 플레이 중 공격력 증가에 총 10회를 투자한 상태에서 다음 1회 투자를 보여주면 언리얼 계산 결과에 따라 `10 + 1`, 투자 후 `11`이 됩니다.

최대 투자에 도달하면 선택한 표시 방식에 맞는 완료 문구가 자동 생성됩니다. UI에 수동 설명 템플릿 입력란이나 투자 상태 미리보기는 없습니다. 일반 문장 설명은 기존 **기본 정보 → 설명**에서 작성합니다. 효과 대상을 **효과 없음**으로 선택하면 일반 설명을 사용합니다.

설명 구성은 [effect-settings.ts](src/effect-settings.ts)의 등록 목록을 사용하고 효과 대상은 프로젝트별 `effectTargets` 목록을 사용합니다. 두 선택값 모두 검증합니다. 설명 표시 방식은 코드의 등록 목록을 사용하며, 효과 대상은 아래 관리 화면에서 편집합니다. 예전 파일에 사용자 정의 효과 대상이나 설명 템플릿이 있으면 다른 속성을 수정해도 유지하며, 지원 목록에서 새 대상을 고르거나 설명 표시 방식을 선택하면 해당 부분을 새 구성으로 교체합니다.

### 효과 대상 관리

상단 **설정 → 효과 대상**에서 편집합니다. 프리셋의 **효과 설정 → 대상 관리**도 같은 설정 창의 효과 대상 탭으로 이동합니다.

1. **새 효과 태그**에 `MachineGun.ReloadSpeed` 같은 태그 ID를 입력하고 **대상 추가**를 누릅니다. 별도 표시 이름이나 자동 생성 ID는 없습니다.
2. 프리셋의 **효과 대상** 목록에서도 동일한 태그만 표시하고 선택합니다. 선택한 태그가 `StatId`에 그대로 저장됩니다.
3. 태그 ID를 고치고 **태그 적용**을 누르면 이 프로젝트의 모든 프리셋(미배치 포함)과 배치의 `StatId`가 함께 변경됩니다. 탭 전환·완료에도 입력을 적용합니다. **태그 복사**로 언리얼 연결 키를 복사할 수 있습니다.
4. 미배치 프리셋을 포함해 어디에서도 사용하지 않는 태그만 삭제할 수 있습니다. 설정 창을 닫고 실행 취소로 추가·변경·삭제와 참조 변경을 함께 되돌릴 수 있습니다.

등록·수정하는 태그는 1~128자이며 영문으로 시작하는 영문·숫자·밑줄 구간을 점(.)으로 구분합니다. 예: `MachineGun.Damage`, `Weapon.MachineGun.ReloadSpeed`. 공백·빈 구간(`A..B`)·앞뒤 점·`None`·대소문자만 다른 중복 태그는 허용하지 않습니다.

대상 목록은 프로젝트의 `effectTargets`에 `{id}` 형태로 저장되고 자동 저장·작업 저장·새 프로젝트에서 유지됩니다. 예제는 예제의 목록으로 교체합니다. 이전 `{id, label}` 파일은 ID와 스킬 참조를 보존하고 표시 이름만 제거합니다. 목록이 없던 파일은 기본 머신건 4종과 기존 스킬의 사용자 정의 ID를 등록하며, 이전 자동 생성 `Stat_...` ID도 유지합니다. 목록을 명시한 파일에 누락된 대상 참조나 중복 ID가 있으면 가져오기를 거부합니다.

언리얼 DataTable JSON에는 기존처럼 각 Row의 `StatId`가 들어갑니다. 미사용 태그까지 보관하려면 **작업 저장**을 사용하세요. 태그 형식은 편집기의 연결 키이며 현재 Row 계약은 `FName`입니다. `FGameplayTag` 등록이나 엔진의 능력치 대응 관계는 자동 생성하지 않습니다. 태그 ID를 바꾸면 이미 내보낸 데이터와 언리얼 쪽 대응 관계도 새 ID로 맞춰야 합니다.

### 런타임 계산 계약

동일한 `StatId`를 가진 **모든 배치 노드**의 투자 효과를 합산합니다. 스킬 프리셋 ID가 달라도 효과 대상이 같으면 합산하며 미배치 프리셋은 계산하지 않습니다. StatId는 언리얼 `FName`과 같이 대소문자를 구분하지 않습니다. 실제 투자 상태는 언리얼에서 **배치 노드 ID별로** 관리합니다.

```text
Flat = Σ(노드 투자 횟수 × 고정 증가량)
Percent = Σ(노드 투자 횟수 × 퍼센트 증가량)
최종 값 = 기본값 × (1 + Percent / 100) + Flat
스킬 증가분 = 최종 값 − 기본값
다음 증가량 = 1회 추가 투자한 상태의 최종 값 − 현재 최종 값
```

퍼센트 증가량 10은 **10%p**입니다. 퍼센트는 기본값에만 적용하고 고정 증가분에는 다시 곱하지 않습니다. 효과별 곱연산·조건부 보너스·스탯 간 의존성은 아직 포함하지 않습니다. 현재 상태와 선택 노드에 1회 추가 투자한 가상 상태를 같은 함수로 계산합니다. 계산은 double 정밀도, 숫자 표시는 소수 최대 3자리입니다. 선행 조건·포인트 비용·실제 구매 가능 여부는 게임에서 처리합니다.

자동 생성 템플릿에는 `DisplayName`, `CurrentBonus`, `Delta`, `NextBonus`, `CurrentValue`, `NextValue`, `CurrentRank`, `NextRank`, `MaxRank` 변수를 사용합니다. 이들은 편집 UI의 입력 항목이 아니라 언리얼 출력 계약입니다. 기존 템플릿을 가져올 때도 허용된 변수인지 검사하며, 수식·임의 변수·중괄호 중첩·서식 연산자와 백틱 이스케이프는 거부합니다. 실제 투자 횟수·현재 계산값은 프로젝트나 DataTable 정의에 저장하지 않습니다.

## 언리얼 분리 테이블 (권장)

**JSON 내보내기**의 기본 출력 구조입니다. 공통 스킬 정의와 트리 배치를 서로 다른 DataTable로 나누고, UMG에서 바로 쓸 수 있도록 캔버스 범위와 연결선 좌표를 미리 계산합니다. Row Struct는 [SkillTreeTypes.h](src/unreal/SkillTreeTypes.h), 해금·수치 규칙의 C++ 참조 구현은 [SkillTreeRules.h](src/unreal/SkillTreeRules.h), 같은 규칙의 TS 참조는 [rules.ts](src/rules.ts)·[effects.ts](src/effects.ts), 출력 생성은 [unreal-export.ts](src/unreal-export.ts)입니다.

| 에셋 (파일 이름) | Row Struct | Row Name | 내용 |
| --- | --- | --- | --- |
| `DT_<TreeId>_Tree` | `FSkillTreeLayoutRow` | 트리 ID | 트리 표시 이름, 노드 경계 `CanvasMin`/`CanvasSize`, 시작 노드, 나머지 세 테이블의 에셋 참조 |
| `DT_<TreeId>_Skills` | `FSkillDefinitionRow` | `SkillId` | 프리셋 = 공통 스킬 정의. 이름·설명·아이콘·모양·색·최대 투자·비용·효과·설명 템플릿 |
| `DT_<TreeId>_Nodes` | `FSkillTreeNodeRow` | 배치 노드 ID | 배치 = 트리의 한 칸. `SkillId` 참조, 위치, 선행 노드, 해금 조건, 깊이 |
| `DT_<TreeId>_Links` | `FSkillTreeLinkRow` | `<From>__<To>` | 노드 테두리 사이 직선의 시작·끝 좌표, 길이, 각도 |

내보내기 창에서 **트리 ID**(에셋 이름 접두사)와 **콘텐츠 폴더**(Tree 행의 테이블 참조 경로, 예: `/Game/SkillTree/Data`)를 지정합니다. 두 값은 프로젝트의 `unreal`에 저장됩니다. 머신건/아틀라스 예제는 `MachineGun`/`ArcaneAtlas`이며, 값이 없는 프로젝트는 `SkillTree`를 사용합니다. 테이블 탭으로 각 파일을 미리 보고 JSON/CSV 중 하나를 고르거나, **전체 ZIP**으로 JSON·CSV·헤더·가져오기 안내를 한 번에 받습니다. **미배치 프리셋 포함**을 켜면 아직 배치하지 않은 프리셋도 Skills 테이블에 넣습니다.

### 필드

| 테이블 | 필드 | 언리얼 타입 | 편집기 원본 / 의미 |
| --- | --- | --- | --- |
| Skills | `DisplayName`, `Description` | `FText` | 프리셋 표시 이름·기본 설명 |
| Skills | `Category` | `FString` | 분류 |
| Skills | `Icon` | `TSoftObjectPtr<UObject>` | 아이콘 에셋 경로 (Texture2D / Material). 비어 있으면 `IconSymbol`을 게임에서 매핑 |
| Skills | `IconSymbol` | `FName` | 편집기 아이콘 ID |
| Skills | `Shape`, `Size` | `ESkillNodeShape`, `int32` | `NodeShape`, `NodeSize` |
| Skills | `Color` | `FColor` (sRGB) | `NodeColor` `#RRGGBB`. 브러시에는 `FLinearColor(Color)` / Blueprint **To LinearColor** |
| Skills | `MaxRank`, `CostPerRank` | `int32` | `MaxLevel`(최대 투자 횟수), `Cost`(투자 1회 비용) |
| Skills | `Effects` | `TArray<FSkillEffect>` | `{StatId, ModifierOp, ValuePerRank}`. 편집기는 0개(효과 없음) 또는 1개를 출력하며, 배열은 다중 효과 확장용 |
| Skills | `DescriptionTemplate`, `MaxDescriptionTemplate` | `FText` | 자동 생성 설명 템플릿. 수치는 `Effects[0]` 기준 |
| Skills | `Tags`, `CustomData` | `TArray<FName>`, `FString` | 태그, JSON 객체 문자열 |
| Nodes | `SkillId` | `FName` | Skills 테이블의 Row Name |
| Nodes | `Position` | `FVector2D` | 노드 좌측 상단 (`X`, `Y`). 슬롯 위치 = `Position - CanvasMin` (+ 여백) |
| Nodes | `Prerequisites` | `TArray<FName>` | 선행 배치 노드 ID |
| Nodes | `PrerequisiteMode` | `ESkillPrerequisiteMode` | `All`: 모든 선행 노드 / `Any`: 선행 노드 중 하나 |
| Nodes | `RequiredParentRank` | `int32` | 선행 노드마다 필요한 투자 횟수 (기본 1). 선행 노드의 최대치보다 크면 "최대 투자"를 뜻함 |
| Nodes | `RequiredTreePoints` | `int32` | 이 노드를 **제외한** 트리 투자 포인트(Σ 투자 × `CostPerRank`)의 하한 (기본 0) |
| Nodes | `Depth` | `int32` | 생성값. 시작 노드 0, 가장 긴 선행 경로 길이. 티어 표시·공개 순서용 |
| Links | `From`, `To` | `FName` | 선행 → 후행 배치 노드 ID |
| Links | `Start`, `End`, `Length`, `AngleDegrees` | `FVector2D`, `float` | 생성값. Image를 `Start`에 두고 정렬·피벗 `(0, 0.5)`, 너비 `Length`, RenderTransform 각도 `AngleDegrees`(+Y 아래, 시계 방향) |
| Tree | `CanvasMin`, `CanvasSize` | `FVector2D` | 모든 노드 경계 상자. 스크롤 캔버스 크기에 사용 |
| Tree | `RootNodes` | `TArray<FName>` | 선행 노드가 없는 배치 |
| Tree | `SkillTable`, `NodeTable`, `LinkTable` | `TSoftObjectPtr<UDataTable>` | `<콘텐츠 폴더>/DT_<TreeId>_<Kind>.DT_<TreeId>_<Kind>` |

해금 조건은 각 배치의 우측 **배치 속성 → 해금 조건**에서 편집합니다. 프리셋이 아니라 배치에 저장되므로 같은 스킬을 두 곳에 배치해도 조건을 따로 줄 수 있습니다. 기본값(`All`/1/0)은 프로젝트 파일에 저장하지 않으며, `Any`인 노드로 들어오는 연결은 캔버스에서 점선으로 표시합니다. 해금 조건은 분리 테이블에만 출력합니다.

### 런타임 규칙 (SkillTreeRules.h)

투자 상태 `TMap<FName, int32>`의 키는 **배치 노드 ID**입니다. 함수는 상태를 바꾸지 않으며 포인트 지급·저장·실제 능력치 적용은 게임이 담당합니다.

| 함수 | 규칙 |
| --- | --- |
| `CanInvest` | 순서대로 `UnknownNode` → `MaxRankReached` → `PrerequisitesNotMet` → `TreePointsNotMet` → `NotEnoughPoints`(보유 포인트 < `CostPerRank`) → `Ok` |
| `CanRefund` | 1회 회수 후에도 투자된 모든 노드가 선행·트리 포인트 조건을 유지할 때만 허용 |
| `TreePoints` | Σ(투자 횟수 × `CostPerRank`). 노드 하나를 제외할 수 있음 |
| `EvaluateStat` | 위 **런타임 계산 계약**과 동일. 배치 노드 ID 순서로 모든 `Effects`를 합산 |
| `BuildPreview` | 다음 1회 투자 설명. 기본값은 `Effects[0].StatId`의 게임 기본값 |

```cpp
SkillTreeRules::FTree Tree{ SkillTable, NodeTable };
if (SkillTreeRules::CanInvest(Tree, NodeId, Ranks, AvailablePoints) == SkillTreeRules::EInvestResult::Ok)
{
    Ranks.FindOrAdd(NodeId)++;
    AvailablePoints -= Tree.Skill(*Tree.Node(NodeId))->CostPerRank;
}
```

### 가져오기

1. `SkillTreeTypes.h`와 `SkillTreeRules.h`를 `Source/<Module>/`에 넣고 빌드합니다. `SkillTreeRow.h`(단일 테이블용)와는 별개이며 함께 넣어도 됩니다.
2. 각 JSON(또는 CSV)을 Import하고 위 표의 Row Struct를 선택합니다. 파일 이름이 에셋 이름이 되므로 이름을 바꾸지 말고 **콘텐츠 폴더**에 가져와야 Tree 행의 참조가 맞습니다.
3. JSON의 구조체는 중첩 객체(`{"X":0,"Y":120}`), 열거형은 이름 문자열입니다. CSV는 같은 열을 언리얼 ImportText 형식(`(X=0,Y=120)`, `("A","B")`, `((StatId="A",ModifierOp="Add",ValuePerRank=1))`)으로 쓰고 UTF-8 BOM을 붙입니다. 여러 줄 설명은 CSV 셀 안의 줄바꿈으로 들어가므로 JSON 가져오기를 권장합니다.

분리 테이블 출력은 편집기에서 다시 열 수 없습니다. 편집용 원본은 **작업 저장**의 `.skilltree.json`입니다. 이 저장소에서는 UnrealHeaderTool 컴파일이나 실제 엔진 Import를 실행하지 않았으므로 처음 적용할 때 엔진에서 Import 결과를 확인하세요.

## 단일 테이블 Row 계약 (이전 형식)

내보내기 창의 **출력 구조 → 단일 테이블**입니다. 기존 `FSkillTreeRow` 사용처와 다시 열기 호환을 위해 유지합니다.

출력은 UTF-8 JSON **배열**이며 노드마다 하나의 Row입니다. 프로젝트 제목이나 편집기 상태는 포함하지 않습니다. 기본 Import Key Field를 사용하면 `Name`이 Row Name입니다. 아래 계약의 C++ 예시: [SkillTreeRow.h](src/unreal/SkillTreeRow.h).

| JSON 필드 | 언리얼 타입 | 의미 |
| --- | --- | --- |
| `Name` | Row Name (`FName`) | 영문/밑줄로 시작하는 영문·숫자·밑줄 1~64자. 대소문자 중복 및 `None` 금지. 구조체 멤버로 추가하지 않음 |
| `SkillId` | `FName` | 공통 스킬 프리셋 ID. 여러 배치 Row가 같은 스킬을 참조할 수 있음 |
| `DisplayName` | `FText` | 프리셋에 정의된 표시 이름 |
| `Description` | `FText` | 기본 설명 (동적 설명을 사용하지 않을 때) |
| `StatId` | `FName` | 합산 대상 능력치. 빈 문자열이면 효과 없음 |
| `ModifierOp` | `FString` | `Add` 또는 `AddPercent` |
| `ValuePerRank` | `double` | 1회 투자 증가량. ±1,000,000 이내 |
| `DescriptionTemplate` | `FText` | 선택한 설명 표시 방식에서 자동 생성된 다음 투자 설명 |
| `MaxDescriptionTemplate` | `FText` | 선택한 설명 표시 방식에서 자동 생성된 최대 투자 완료 설명 |
| `X`, `Y` | `float` | 캔버스 내 노드 좌측 상단 위치. 오른쪽 +X, 아래쪽 +Y. 줌/패닝과 무관 |
| `Category` | `FString` | 자유 분류. 예제의 화염·냉기·번개는 편집기에서 색상으로 구분 |
| `Icon` | `FString` | 예: `/Game/UI/Icons/T_Flame.T_Flame`. 실제 에셋을 확인하거나 썸네일을 로드하지 않음 |
| `IconSymbol` | `FString` | 편집기의 기본 실루엣 아이콘 ID. 선택 가능: `machine-gun`, `machine-gun-magazine`, `crosshair`, `supersonic-bullet`. UMG에서는 이 ID를 실제 아이콘 리소스에 매핑하거나 `Icon` 경로를 사용 |
| `NodeShape` | `FString` | `Square`, `Diamond`, `Circle` |
| `NodeSize` | `int32` | 24~96. 가로·세로 동일한 노드 영역 크기. 기본 36 |
| `NodeColor` | `FString` | sRGB `#RRGGBB` 색상. 예: `#c58d77` |
| `Cost` | `int32` | 0 이상 습득 비용 |
| `MaxLevel` | `int32` | 최대 투자 횟수. 1 이상의 정수, 1이면 한 번만 습득. UI에서 설정한 값 그대로 저장 |
| `Prerequisites` | `TArray<FName>` | 선행 노드 Row Name 배열. 빈 배열이면 시작 노드 |
| `Tags` | `TArray<FString>` | 쉼표로 입력한 문자열 태그. GameplayTag 등록은 별도 |
| `CustomData` | `FString` | JSON 객체를 인코딩한 문자열. 예: `"{\"Damage\":25}"`. 임의 필드를 Row 최상위에 추가하지 않음 |

단일 테이블의 `Prerequisites`는 모든 선행 스킬을 요구하는 AND 조건으로 해석하는 계약입니다. 배치별 해금 조건(`Any`, 요구 투자 횟수, 트리 포인트)은 분리 테이블에만 출력합니다. 순환·자기 연결·중복 연결·없는 노드 참조를 차단합니다. 서로 연결되지 않은 여러 루트/트리는 허용합니다. 최대 2,000 노드, 가져오기 파일 10MB, 좌표 ±1,000,000 범위를 검증합니다. 상한은 입력 보호용이며 2,000노드에서의 편집 성능 보장은 아닙니다.

### 언리얼에서 사용

1. C++ 프로젝트의 `Source/<Module>/`에 `SkillTreeRow.h`를 복사하고 빌드해 `FSkillTreeRow`를 등록합니다. `Name`은 Row Key이므로 별도 UPROPERTY로 넣지 않습니다. `SkillId`는 실제 UPROPERTY로 추가합니다. Blueprint 사용자 정의 Struct를 쓰면 위 필드의 이름·타입을 정확히 맞춰야 하며, 엔진에서 출력한 샘플 JSON과 실제 필드명을 먼저 비교하세요.
2. 내보낸 `.datatable.json`을 Content Browser에서 Import하고 DataTable의 Row Type을 `SkillTreeRow`로 선택합니다. Import Key Field는 기본값(빈 값)을 유지합니다. 프로젝트 저장 파일 `.skilltree.json`은 언리얼 Import용이 아닙니다.
3. 이후 UMG 구현에서 Row마다 노드 위젯을 만들고 CanvasPanelSlot의 Anchor/Alignment를 `(0,0)`으로 설정해 `X/Y`를 적용하고 슬롯 크기를 `(NodeSize, NodeSize)`로 맞춥니다. 모양은 이 정사각형 경계 안에 들어갑니다. 마름모는 실제 네 꼭짓점이 위·오른쪽·아래·왼쪽의 중앙에 위치하며, 내부 정사각형을 `NodeSize / sqrt(2)` 크기로 45° 회전한 형태입니다. 음수 좌표를 사용하면 스크롤 영역이나 별도의 공통 원점 보정이 필요합니다.
4. `Prerequisites`로 노드 간 직선을 그립니다. 중심은 `(X + NodeSize/2, Y + NodeSize/2)`이고 두 중심 사이 직선과 각 노드 모양의 경계 교점이 선의 시작·끝입니다. [appearance.ts](src/appearance.ts)의 `connectionEndpoints`가 계산 참조입니다. `Icon` 로드와 `CustomData` 해석, 습득 조건·상태 저장은 게임에서 구현합니다. 기존 Row Struct를 이미 사용 중이면 디자인 필드 4개·`SkillId`와 위 효과/템플릿 필드 5개를 추가해야 합니다.

### 언리얼 수치 계산 연결

내보내기 창에서 **구조체 예시 (.h)**와 **수치 계산 예시 (.h)**를 받거나 [SkillTreeRow.h](src/unreal/SkillTreeRow.h), [SkillTreePreview.h](src/unreal/SkillTreePreview.h)를 함께 프로젝트에 넣습니다. 계산 헤더는 C++ 참고 구현이며 Blueprint 함수 라이브러리로 자동 등록하지는 않습니다.

```cpp
// Investments: DataTable Row Name -> 현재 투자 횟수. SkillId를 키로 쓰지 않습니다.
SkillTreePreview::FResult Preview;
if (SkillTreePreview::Build(*SkillTable, SelectedNodeId, Investments, BaseDamage, Preview))
{
    DescriptionTextBlock->SetText(Preview.Description);
}
// 실제 능력치 적용에도 같은 Evaluate 함수를 사용합니다.
const double Damage = SkillTreePreview::Evaluate(
    *SkillTable, FName(TEXT("MachineGun.Damage")), Investments, BaseDamage);
```

`BaseDamage` 자리에는 **선택 StatId의 기본값**을 전달합니다. 공격력 외 스탯을 선택했다면 그 스탯의 기본값을 전달해야 합니다. `Build`는 투자 상태 복사본에만 1회를 더하므로 실제 포인트를 소비하지 않습니다. 스킬 선택·투자·초기화·기본 능력치 변경 시 다시 호출해 UMG 설명을 갱신하세요. Blueprint 전용 프로젝트에서는 위 계산과 `Format Text`를 같은 규칙으로 구성하거나 C++ 함수를 BlueprintCallable 래퍼로 노출할 수 있습니다. 숫자 구분 기호 등은 언리얼의 활성 문화권에 따라 달라질 수 있습니다.

언리얼 Import에는 사전에 Row Struct가 필요합니다. 공식 자료: [UDataTable API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UDataTable), [Data Driven Gameplay Elements](https://dev.epicgames.com/documentation/unreal-engine/data-driven-gameplay-elements-in-unreal-engine). 구조체 및 계산 예시는 데이터 계약과 알고리즘 참조를 제공하기 위한 것으로 이 저장소에서 UnrealHeaderTool 컴파일이나 실제 엔진 Import를 실행하지는 않습니다.

## 검증

```powershell
npm run test       # JSON 왕복, 참조 갱신, DAG/입력 검증, 실행 취소
npm run build      # TypeScript + Vite 프로덕션 빌드
npx playwright install chromium  # 최초 실행 시 브라우저가 없으면 설치
npm run test:e2e   # 노드/연결 드래그·재연결·Alt 해제·취소·JSON 왕복·복원
```

`npm run verify`는 단위 테스트·빌드·브라우저 검사를 순서대로 실행합니다. UI 검사 스크린샷은 git에서 제외된 `artifacts/skill-tree-studio.png`에 저장됩니다. 순수 웹 편집기 검증이며 언리얼 프로젝트의 빌드·DataTable Import 검증을 대체하지 않습니다.

## 아이콘 출처

스킬 아이콘은 **머신건·탄창·조준경·관통탄 4종**만 제공합니다. 새 프리셋의 기본 아이콘은 머신건입니다. 이전 저장 파일의 다른 아이콘 ID는 데이터 호환을 위해 보존하지만, 그림은 머신건으로 표시합니다. 아이콘 선택기에서는 지원하는 4종으로 교체할 수 있습니다.

아이콘은 [Game-icons.net](https://game-icons.net)의 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) 실루엣입니다. 원본 경로는 변경하지 않고 표시 색상과 크기만 바꿉니다. 원본: [game-icons/icons](https://github.com/game-icons/icons), 배포 데이터: `@iconify-json/game-icons`.

- Skoll: machine-gun.
- Delapouite: machine-gun-magazine, crosshair.
- Lorc: supersonic-bullet.

`node scripts/extract-icons.mjs`로 설치된 패키지에서 필요한 아이콘만 `src/game-icons.json`에 추출할 수 있습니다. 전체 라이브러리는 실행 번들에 포함하지 않습니다. 언리얼 게임에 아이콘을 재사용할 때도 이 출처와 라이선스 고지를 유지하세요.
