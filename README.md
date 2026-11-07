# 입고살까

에이전트가 의류의 가격과 개인 적합성을 나눠 보여 주고, 사용자의 명시 승인 뒤 모의 결제 결과를 남기는 로컬 Bun/TypeScript 스킬 데모입니다. 전용 앱은 없습니다.

## 현재 작동하는 범위

- F&F 정적 카탈로그의 성인 상품 검색, 최대 3개 후보, 참고가격 카드.
- 지속 로컬 프로필의 버전과 준비 상태를 확인하는 적합성 카드.
- A.X K2 실제 호출: 한국어 요청 조건 추출과 판단 절차 설명.
- 상품·옵션·가격·프로필 버전·유효 시간에 묶인 명시 승인.
- 모의 결제 영수증, 취소, 중복 승인 방지. **실제 송금 0회, 주문·배송 없음.**
- OpenAI `images/edits` 호출 경로. 키가 없으면 **`키 대기`**. 이미지 생성 성공을 가장하지 않습니다.

Maroo는 준비된 MAWS 인증·에이전트·수취인·수수료 집행 조건을 찾지 못해 구현 경로를 simulation으로 고정했습니다. Maroo 또는 SKT Agentic Pay 연동 성공을 주장하지 않습니다.

## 실행

Bun 1.3.14 이상, pnpm, macOS `sips`가 필요합니다. `sips`는 자체 SVG 의류 디자인을 이미지 API 입력 PNG로 바꾸는 데만 사용됩니다.

```sh
pnpm install
export FASHION_HOME="/path/to/private/oba-skt-fashion"
export OBA_KEY_FILE="/path/to/private/skt-axk2.key"

bun src/cli.ts explain --request "8만원 이하 맨투맨"
bun src/cli.ts search_catalog --budget 80000 --item 맨투맨
bun src/cli.ts search_catalog --budget 50000 --item 맨투맨
bun src/cli.ts fit_card --source own --sku OWN-001
bun src/cli.ts price_card --source own --sku OWN-001
bun src/cli.ts tryon --source own --sku OWN-001
```

기본 `--source ff`는 F&F 샘플, `--source own`은 이 저장소에서 만든 가상 의류 디자인입니다. 두 출처를 같은 상품으로 연결하지 않습니다. 자체 디자인의 가격 역시 시연용 설정이고 실제 판매가가 아닙니다.

`FASHION_HOME`의 로컬 입력:

```text
ff-data/package/participant-kit/
  data/products.json
  data/snapshot.json
  assets/products/...
profile/body-profile.json
tryon-consent.json
demo/                         # 결과, 로컬 카드, 견적, 생성물이 생기는 위치
```

프로필은 기존 파일을 읽기만 합니다. 사진 항목은 `{slot, file, status}`, `file`은 로컬 파일 경로입니다. 미제공 사이즈·핏 선호를 추정하지 않습니다. 프로필 파일 내용이 바뀌면 버전 해시가 바뀌어 기존 견적 승인이 무효가 됩니다. 신체 수치와 원본 사진은 저장소로 복사하지 않습니다.

## 승인

가격과 적합성에 대한 사용자의 응답을 먼저 받습니다. 아래 플래그는 그 실제 응답을 기록하는 것이며, 모델이 대신 결정하는 옵션이 아닙니다.

```sh
bun src/cli.ts quote --source own --sku OWN-001 \
  --price accepted --fit accepted-with-unknown-size \
  --option "사이즈 미정 (모의 판단)"
```

출력된 현재 견적의 `approval` 문자열을 보여 주고 **다음 사용자 응답을 기다립니다.** 그 문자열과 견적 ID를 그대로 전달해야 실행됩니다.

```text
bun src/cli.ts approve_and_pay --source own --sku OWN-001 \
  --quote <출력된-견적-ID> --approval "<사용자가-명시-승인한-문자열>"
```

`--cancel`은 승인을 요구하지 않고 취소합니다. 취소한 견적이나 완료된 견적을 다시 실행하지 않습니다. “좋네”나 사진 전송 동의는 결제 승인이 아닙니다. 견적은 15분 동안만 유효합니다.

## 착장과 데이터 경계

**F&F 자료는 로컬 처리·표시 전용입니다.** OpenAI, A.X, 원격 에이전트 문맥, GitHub에 상품 원문·이미지를 업로드하지 않습니다. 원격 에이전트에서 F&F 명령을 호출할 때는 stdout을 모델 문맥에 붙이지 말고 로컬 사용자 화면이나 로컬 파일로만 전달해야 합니다.

- OpenAI 입력은 동의한 `body_front`, `face_45`, 자체 디자인 의류 PNG입니다.
- F&F SKU로 `tryon`을 호출하면 `rights_required`이며 네트워크 호출은 없습니다.
- A.X에는 일반 검색 요청만 전송합니다. 상품 데이터·사진·신체정보를 보내지 않습니다.
- 자체 디자인 SVG는 제작한 의류 그림이지 생성된 착장 사진이 아닙니다.
- 생성 이미지는 실제 핏·치수·착용감을 보장하지 않습니다. 얼굴·체형·의류 왜곡은 사람이 실제 이미지를 보고 검수해야 합니다.
- 원본 인물 사진을 지우거나 다른 슬롯을 추가 전송하지 않습니다.

키는 1Password `claw` 서비스 계정으로만 읽습니다. 앱은 `~/.config/openclaw/1password.env`를 source한 자식 프로세스에서 서비스 토큰 존재를 확인하고 `op item get --vault claw --fields ... --reveal`로 지정 필드만 읽습니다. 비밀값은 로그나 결과 파일에 쓰지 않습니다. 키가 실제로 저장된 뒤 유효한 참조를 지정합니다. 항목명에 `/`가 있으면 이름 대신 항목 ID를 사용하세요.

```sh
export OPENAI_KEY_REF="op://claw/<실제-항목-ID>/<실제-키-필드>"
```

동의 파일은 사용자 승인에 근거해 로컬에 작성합니다. 예제 값은 동의 자체가 아닙니다.

```json
{
  "id": "실제-동의-기록-ID",
  "provider": "OpenAI",
  "slots": ["body_front", "face_45"],
  "garmentSource": "own-design",
  "maxRequests": 1
}
```

API 요청은 자동 재시도하지 않습니다. 동일 입력은 성공한 로컬 캐시를 명시해서 재사용합니다. 실행 시도 뒤 중단되면 `unknown`으로 멈추며, 기존 `.attempt` 기록을 지워 자동 재과금시키지 마세요. 키 부재·동의 부재·권한 부재·실패·결과 불명을 서로 구분합니다. 현재 라이브 이미지 API는 키 부재로 미검증입니다.

## 두 흐름 리허설

```sh
bun src/demo.ts
pnpm typecheck
bun test
```

`demo/flows.json`과 `demo/demo.md`를 저장합니다.

1. **가격 우선:** “8만원 이하 맨투맨” → F&F 성인 후보 → 가격 → 핏 → 모의 견적 → 모의 영수증.
2. **특정 상품:** 자체 디자인 `OWN-001` → 핏 → 착장 준비 상태 → 가격 → 모의 견적 → 모의 영수증.

“5만원 이하 맨투맨”은 성인 후보가 없는 실제 데이터의 경계 조건으로 확인합니다. 예산 안의 아동 상품을 성인에게 추천하지 않습니다. 참고가격을 예산에 맞춰 바꾸지 않습니다.

리허설의 판단·승인은 `scripted-demo`로 표시됩니다. 소유자의 실제 선택·구매 승인이라고 기록하지 않습니다. 이미지 키가 없어도 비이미지 단계는 끝까지 실행하지만, 이미지 완료로 세지 않습니다.

## 행사 종료 후 정리

F&F 안내는 **외부 유출되지 않도록 행사 종료 후 삭제**를 요구합니다. `ff-data/` 전체, 브라우저 다운로드 ZIP 사본, F&F 내용을 포함한 `demo/flows.json`, `demo/demo.md`, F&F 견적·카드와 파생 캐시를 삭제 대상으로 확인하세요. 이 저장소에는 해당 자료를 커밋하지 않습니다. 원본 인물 사진과 자체 디자인은 별개이며 일괄 삭제 대상에 넣지 마세요. 이 데모는 자동 삭제 작업을 등록하지 않습니다.

## 근거

- [F&F 참가자 자료](https://app.notion.com/p/F-F-4103f43d95de81808acde9fa2a026005)
- [OpenAI Images edit API](https://developers.openai.com/api/reference/resources/images/methods/edit)
- [Maroo 빌더 자료](https://maroo-builder-resources.vercel.app/)
- [MAWS 설정](https://docs.maroo.io/guides/agents/guide-setting-up-maws)

이 프로젝트는 쇼핑 판단 데모이며 F&F VMD 트랙이나 SKT Agentic Pay 필수 조건을 충족했다는 증거가 아닙니다.
