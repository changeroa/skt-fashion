# 구현된 도구

저장소 루트에서 `bun src/cli.ts`를 실행한다. `--source ff`가 기본이며 `own`은 별도 자체 디자인 카탈로그다. 환경·로컬 입력·출력 폴더는 루트 README를 따른다.

| 명령 | 필수 입력 | 결과 |
|---|---|---|
| `search_catalog` | `--budget`; 선택 필터 `--category` 또는 `--item` | 성인 후보 최대 3개, 참고가격 모드, found/empty |
| `price_card` | `--sku` | 참고가격, 실제 총액 null, 대안·미확인 |
| `fit_card` | `--sku`; 선택 `--observation <로컬 JSON>` | 이미지·한 줄 스타일·대안 차이·소재·실루엣, 별도 사이즈 판단 |
| `explain` | `--request` | A.X K2 조건·한국어 설명; 일반 질의만 전송 |
| `tryon` | `--source own --sku` | 권한/동의/키 대기 또는 실제 이미지 결과 |
| `quote` | `--sku --price accepted --fit accepted-with-unknown-size --option` | 모의 견적과 정확한 승인 문자열 |
| `approve_and_pay` | `--sku --quote --approval` 또는 `--cancel` | 영속 모의 영수증 또는 취소, 송금 0회 |
| `change_selection` | 없음 | 이전 미실행 견적 즉시 폐기; 옵션 변경 직후 호출 |

모든 명령에 `--session <대화 ID>` 또는 환경변수 `FASHION_SESSION`을 전달하면 공통 `sessionLimits`는 그 대화 최초 성공 호출에만 반환된다. `--actor scripted-demo`는 리허설 전용이며 사용자 견적을 폐기하지 않는다.

## 실제 공급자

- A.X: `POST https://agent-os-biz.adot.ai/oba/v1/chat/completions`, 모델 `skt/a.ll/A.X-K2-ADOT`, JSON 조건 추출.
- 이미지: `POST https://api.openai.com/v1/images/edits`, `gpt-image-2.5-sunburst`, multipart, 이미지 3개(동의 인물 2 + 자체 디자인 1), WebP 1024×1536, medium, n=1.
- 이미지 모델의 접근 권한과 라이브 생성은 키가 생긴 뒤 별도 검증해야 한다. OpenAI 기본 API는 입력 데이터가 외부 처리된다는 뜻이다.
- 결제: simulation. MAWS 설정·로그인·지갑 생성·자금 지원·정책 변경·송금은 구현·실행하지 않았다.

## 상태

`키 대기`와 `consent_required`는 이미지 API 호출 0회다. `rights_required`는 F&F 전송 차단이다. 성공 캐시는 `cached:true`. HTTP 실패는 `failed`, 요청 뒤 불명은 `unknown`. 같은 입력의 실행 시도는 영속 `.attempt` 파일로 중복 호출을 막는다. 반환된 `image` 파일이 실제로 존재하고 직접 검수한 뒤에만 이미지를 보여 줬다고 말한다.

견적은 15분 유효하며 상품·가격·프로필·옵션 변경 시 무효다. `approve_and_pay`는 현재 선택의 견적 ID, 전체 해시, 재사용하지 않는 4자리 코드(`승인 1234`)를 검증한다. 새 견적과 `change_selection`은 기존 미실행 견적을 `superseded`로 만든다. 실행 후 취소에는 `cancellation:not_allowed`와 `실행 후 취소 불가`를 반환하고 영수증은 `simulated`로 보존한다. 실행 전 취소는 `cancelled`, `취소됨(모의)`다.

### 이미지 관찰과 선호

`profile/style-preferences.json`: 선택 필드 `upperBodyBuild` (`muscular|broad|unspecified`), `genre` (`amekaji|street|classic|minimal|gorpcore|workwear|sporty`), `occasion` (`casual|office|formal|outdoor`), `contrast` (`low|high`). 실제 사용자 발화만 기록한다.

`demo/<SKU>.style.json`: `sku`, `profileVersion`(착장 캐시의 사진 버전), `image`, `imageSha256`와 선택 관찰 `shoulderChest` (`relaxed|tight|unknown`), `topVolume` (`regular|oversized|unknown`), `bottomVolume` (`slim|straight|wide|unknown`), `length` (`cropped|regular|long|unknown`), `sleeve` (`wrist|over-hand|short|unknown`), `contrast` (`low|high|unknown`). 호스트가 이미지를 직접 검수한 뒤에만 작성한다.

선호의 선택 필드 `silhouetteGoal`은 `balanced|relaxed|leg-line`이다. 관찰의 선택 `fabric`은 `{verified:true, drape:"structured"|"fluid"}`이며 사진으로 본 떨어짐만 담는다. 명세의 `product.fabric` 스키마와 규칙은 [소재 지식](fabric-knowledge.md)을 따른다. `price_card --observation`도 같은 관찰 결합 검증을 적용한다.

F&F 원본의 상품 ID는 실제 회사 SKU가 아니고, 참고가격은 실구매 가격이 아니다. 이 스키마에 없는 배송·세금·실측·사이즈별 재고를 만들어 넣지 않는다.
