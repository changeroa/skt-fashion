# 구현된 도구

저장소 루트에서 `bun src/cli.ts`를 실행한다. `--source ff`가 기본이며 `own`은 별도 자체 디자인 카탈로그다. 환경·로컬 입력·출력 폴더는 루트 README를 따른다.

| 명령 | 필수 입력 | 결과 |
|---|---|---|
| `search_catalog` | `--budget`; 선택 필터 `--category` 또는 `--item` | 성인 후보 최대 3개, 참고가격 모드, found/empty |
| `price_card` | `--sku` | 참고가격, 실제 총액 null, 대안·미확인 |
| `fit_card` | `--sku` | 프로필 버전, 준비 슬롯, 핏 미확인 |
| `explain` | `--request` | A.X K2 조건·한국어 설명; 일반 질의만 전송 |
| `tryon` | `--source own --sku` | 권한/동의/키 대기 또는 실제 이미지 결과 |
| `quote` | `--sku --price accepted --fit accepted-with-unknown-size --option` | 모의 견적과 정확한 승인 문자열 |
| `approve_and_pay` | `--sku --quote --approval` 또는 `--cancel` | 영속 모의 영수증 또는 취소, 송금 0회 |

## 실제 공급자

- A.X: `POST https://agent-os-biz.adot.ai/oba/v1/chat/completions`, 모델 `skt/a.ll/A.X-K2-ADOT`, JSON 조건 추출.
- 이미지: `POST https://api.openai.com/v1/images/edits`, `gpt-image-2.5-sunburst`, multipart, 이미지 3개(동의 인물 2 + 자체 디자인 1), WebP 1024×1536, medium, n=1.
- 이미지 모델의 접근 권한과 라이브 생성은 키가 생긴 뒤 별도 검증해야 한다. OpenAI 기본 API는 입력 데이터가 외부 처리된다는 뜻이다.
- 결제: simulation. MAWS 설정·로그인·지갑 생성·자금 지원·정책 변경·송금은 구현·실행하지 않았다.

## 상태

`키 대기`와 `consent_required`는 이미지 API 호출 0회다. `rights_required`는 F&F 전송 차단이다. 성공 캐시는 `cached:true`. HTTP 실패는 `failed`, 요청 뒤 불명은 `unknown`. 같은 입력의 실행 시도는 영속 `.attempt` 파일로 중복 호출을 막는다. 반환된 `image` 파일이 실제로 존재하고 직접 검수한 뒤에만 이미지를 보여 줬다고 말한다.

견적은 15분 유효하며 상품·가격·프로필·옵션 변경 시 무효다. `approve_and_pay`는 현재 견적 전체의 해시를 승인 문자열에 묶는다. 재실행은 기존 결과를 읽으며, 취소는 실행으로 바뀌지 않는다.

F&F 원본의 상품 ID는 실제 회사 SKU가 아니고, 참고가격은 실구매 가격이 아니다. 이 스키마에 없는 배송·세금·실측·사이즈별 재고를 만들어 넣지 않는다.
