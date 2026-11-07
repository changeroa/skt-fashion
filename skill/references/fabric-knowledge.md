# 소재 판단: 핏·가격 카드용

상품에 적힌 소재·조직·중량을 우선한다. 카테고리 이름이나 사진만으로 면 함량, GSM, 온스, 게이지를 만들지 않는다. 실측 사이즈 추천과 소재에 따른 착용 경향은 별개다.

## 카드 사용 계약

`fabricAdvice({ fabric, imageObservation, length, sleeveBreak, upperBodyBuild })`는 순수 함수다. 상품 JSON은 `fabricSchema`로 먼저 파싱한다. 모든 입력은 선택 사항이며 `undefined`도 허용한다.

- `fabric`: `material` = cotton / polyester / nylon / wool / other, `construction` = fleece / french-terry / loopback / jersey / denim / ripstop / flannel / knit / woven. 모두 선택.
- 선택 수치: 양수 `gsm`(g/m²), `oz`(oz/yd²), 양의 정수 `gauge`. 게이지 비교에는 `gaugeUnit` = needles-per-inch / needles-per-1.5-inches가 필요하다.
- 선택 `composition`: `{ fiber: material과 같은 열거값, percent: 0..100 }[]`. 중복 섬유 금지, 합계 100% 이하; 일부 함량만 알려져도 허용한다. 함량이 있으면 포괄적인 `material`보다 우선한다. 실제로 없는 섬유를 추가하지 않는다.
- 선택 상품 특성: `drape` = structured / fluid, `stretch`, `breathability` = low / high. 상세페이지 등으로 확인된 값만 넣는다.
- `imageObservation`: `{ verified: true, drape: "structured" | "fluid" }`. 실제 이미지를 확인한 상위 호출자가 공급한다. 섬유·중량·신축·통기성은 사진 관찰 입력에 없다.
- `length`: cropped / regular / long / unknown. `sleeveBreak`: above-wrist / at-wrist / below-wrist / unknown. `upperBodyBuild`: muscular / broad / unspecified. 길이·체형은 상위 프로필/관찰 근거에서 받는다. 미지정은 unknown/unspecified와 같다.
- 반환: `{ opinion, valueOpinion, silhouetteOpinion, basis, ruleIds }`. 세 문장은 각각 줄바꿈 없는 한 줄. `basis`는 product / image-estimate / unknown. `ruleIds`는 실제 사용한 아래 규칙의 중복 없는 목록.

핏 카드에는 `소재` = `opinion`, `실루엣·착용감` = `silhouetteOpinion`, 가격 카드에는 `소재 관점` = `valueOpinion`. 원단 경향은 “~쪽/~가능”으로 짧게 쓴다. 가격의 적정성·할인율은 이 API가 판정하지 않는다. 중량이 높다는 이유만으로 고급·내구·비싼 값어치를 보장하지 않는다.

## 안정 규칙 ID

아래 수치 경계와 실루엣 조합은 **이 앱의 상담 휴리스틱**이다. 산업 공통 등급·실험 결과가 아니다. 동일 조직 안에서 비교하며 가공·패턴·안감이 결과를 바꿀 수 있다.

| ID | 입력 조건 | 소재·관리·구매 판단 |
|---|---|---|
| FA01 | 면 명시 또는 양의 면 함량 | 부드러운 일상 착용, 땀에 젖으면 합성섬유보다 건조가 느린 편. 구김·세탁 후 치수는 가공과 케어라벨 확인. 수축률을 임의 수치화하지 않음. [S2,S3] |
| FA02 | fleece | 이 앱에서는 기모 스웨트 조직으로 정규화. 기모의 포근함, 서늘한 계절 레이어. **fleece가 곧 면이라는 뜻은 아님**. [S1] |
| FA03 | french-terry 또는 loopback | 안쪽 비기모 루프 조직. 부드러움과 통기 경향, 간절기 레이어. 루프백은 이 상담에서 같은 분기로 취급. 두께는 GSM 별도. [S1] |
| FA04 | denim, 중량 <12oz | 같은 데님 중 가벼운 쪽, 움직임·따뜻한 계절 착용 후보. 부드러움·스트레치는 별도. [S4] |
| FA05 | denim, 12..16oz | 중간 중량, 일상 착용과 형태감 균형 후보. [S4] |
| FA06 | denim, >16oz | 묵직한 쪽, 길들이기·활동성 확인. 출처는 17oz 이상을 heavyweight라 부름; 16..17 사이 소수값은 앱에서 이 분기에 포함. [S4] |
| FA07 | 나일론 명시 또는 양의 함량 | 건조·마찰 대응을 살필 후보. 통기성·방수는 조직/코팅과 별도이므로 자동 보장하지 않음. [S2,S3] |
| FA08 | ripstop | 찢김 확산 억제를 노린 보강 조직. 섬유는 나일론·폴리 등 별도 정보; 격자만 보고 방수·고가 원단이라 판단하지 않음. [S7] |
| FA09 | 울 명시 또는 양의 함량 | 습도 조절·구김 회복 경향. 여름용 경량 울도 존재; 울=겨울 전용 아님. 세탁 라벨 우선, 니트는 접어 보관·평건조. [S3,S5] |
| FA10 | flannel | 기모/밀링 표면의 부드러운 촉감. 면 플란넬도 있으므로 울로 추정 금지. 울 플란넬은 축융 수축·워셔블 가공 여부 확인. [S6] |
| FA11 | knit, 인치당 게이지 ≤7 | 굵은 조직 쪽의 시각적 볼륨. 저게이지 자체가 높은 보온·고품질의 증명은 아님. [S8] |
| FA12 | knit, 인치당 게이지 ≥12 | 고운 조직 쪽, 레이어링 후보. 1.5인치당 수치는 인치당으로 환산; 단위 없으면 이 규칙 미적용. 원사·조직이 다르면 직접 비교 금지. [S8] |
| FA13 | 양의 면·폴리 함량 둘 다 있음 | 촉감과 건조/관리의 절충 후보. 합성 100%보다 느리게 마를 수 있음; 구김·수축 감소는 함량만으로 보장 불가. 혼방=저급 아님. [S2,S3] |
| FA14 | 비데님, GSM ≤180 | 같은 조직 내 가벼운 쪽. 얇은 저지는 드레이프·몸선 노출 가능성을 살핌. GSM만으로 비침·통기·여름 적합 확정 금지. [S3] |
| FA15 | 비데님, 180<GSM<350 | 같은 조직 내 중간 중량, 간절기 레이어 후보. 보온은 기모/공기층과 함께 판단. [S1,S3] |
| FA16 | 비데님, GSM ≥350 | 같은 조직 내 묵직한 쪽. 기모·테리의 형태감/부피 후보, 더운 실내 착용 확인. 무게=강성은 아님. [S1,S3] |
| FA17 | 쓸 만한 상품 소재와 확인된 관찰 모두 없음 | 짧은 다음 행동: 혼용률/소재표, 같은 조직 제품 가격, 총장·소매 실측 확인. 카테고리로 메우지 않음. |
| FA18 | 상품 소재 판단 불가, 확인된 drape 관찰 있음 | 외관만 활용, 관련 문장에 `사진 추정:` 명시. 촉감·함량·중량·품질/적정가격은 판단하지 않음. |
| FA19 | 상품 근거는 있으나 형태감 근거 없음 | 소재 의견은 제공하되 실루엣에는 총장·원단 떨어짐 확인을 안내. 사진으로 빈 속성을 섞지 않음. |
| FA37 | 폴리 명시/양의 함량, 면 혼방 분기 아님 | 빠른 건조 후보, 통기성은 조직에 따라 달라짐. 폴리=나쁜 촉감으로 단정하지 않음. [S2,S3] |
| FA38 | jersey | 움직임·몸선 노출은 두께와 핏에 따라 다름. 저지라는 이름만으로 경량·면으로 간주하지 않음. [S2,S3] |
| FA39 | woven | 조직과 실측 여유를 함께 확인. 직물이라는 이유만으로 신축 없음/방풍을 확정하지 않음. [S3] |
| FA40 | knit, 비교 가능한 저/고게이지 정보 없음 | 원사·조직·게이지 단위 확인. 수치 단위가 없으면 저/고게이지 분기 대신 사용. [S8] |
| FA41 | denim, 면적중량 없음 | 온스·신축 확인. 데님이라는 이유만으로 무거움·면 함량을 만들지 않음. [S4] |

데님 `oz`가 없고 GSM만 있으면 `oz = gsm / 33.9057`로 면적중량 단위만 환산한다. `oz`와 GSM이 함께 있으면 명시된 데님 `oz` 우선. 비데님은 GSM 우선, 없으면 oz를 GSM으로 환산한다. 어느 경우도 사진에서 수치 추정하지 않는다.

## 원단 × 길이 × 체형: 실루엣·착용감

먼저 상품의 명시적 `drape`를 사용한다. 없으면 ≥350GSM fleece/french-terry/loopback을 structured **경향**, ≤180GSM jersey를 fluid **경향**으로 다룬다. 게이지·섬유·GSM 단독으로 강성을 확정하지 않는다. 무거워도 유연한 원단이 있다.

| 원단 떨어짐 | cropped | regular | long |
|---|---|---|---|
| structured / 헤비 스웨트 경향 (FA20) | FA22: 짧고 가로가 살아 박시한 쪽; 허리선이 드러나 다리 비율 강조 가능 | FA23: 몸에서 떠 직선적인 쪽; 어깨·품 여유 확인 | FA24: 몸통 부피와 세로 면적이 함께 커 보이는 쪽; 엉덩이 덮임 확인 |
| fluid / 경량 저지 경향 (FA21) | FA25: 짧게 흘러 허리·복부 선이 드러날 수 있음 | FA26: 몸선을 따라 자연스럽게 흐르는 쪽 | FA27: 세로로 흐르며 가슴·복부에 붙거나 밑단이 쌓일 수 있음 |

길이가 unknown이면 FA20/FA21의 형태감만 말한다. 키·체중만으로 cropped/regular/long을 정하지 않는다. 길이는 착용자의 실제 몸통·밑위와 상대 비교하는 입력이다. 이 표는 스타일 해석이며 출처가 체형별 결과를 실험했다는 뜻이 아니다.

- FA28 muscular: 가슴·상완 여유를 확인한다. 뻣뻣하고 짧으면 상체 폭이 강조될 수 있고, 얇고 흐르면 근육·가슴 윤곽이 드러날 수 있다.
- FA29 broad: 어깨선·가슴 여유를 확인한다. 크롭 구조 원단은 가로 비율, 긴 유연 원단은 세로 비율이 강조되는 경향. 체형을 결점으로 표현하지 않는다.
- FA30 above-wrist: 손목 노출로 끝선이 가벼워 보임. FA31 at-wrist: 손목에서 정돈. FA32 below-wrist: 손등 덮임/주름 쌓임으로 볼륨이 늘어 보임. 이것만으로 소매가 작다/크다고 결론내지 않는다.
- FA33 stretch high: 움직임 여유에 유리한 쪽. FA34 stretch low: 가슴·상완 실측 여유 확인. 신축과 복원력은 다르며 폴리 혼방만으로 스트레치를 만들지 않는다.
- FA35 breathability high: 열·습기 배출에 유리한 쪽. FA36 breathability low: 더운 실내 답답함 확인. 통기성과 보온·방수는 각각 다른 특성이다. [S3]

`upperBodyBuild`는 호출자가 프로필에서 공급하는 일반 분류다. 개인 이름·신체 정보·사진은 이 문서나 외부 조사 도구에 넣지 않는다.

## 확인한 원문

2026-11-07 실제 페이지 본문을 가져와 확인. 제품 예시는 일반 등급 규격이 아니라 조직 설명의 근거로만 사용했다.

- S1 Nike, 기모와 비기모 루프/형태감: https://www.nike.com/gb/w/club-fleece-hoodies-sweatshirts-6riveza5r7s
- S2 REI, 면·면폴리·합성 소재와 관리 절충: https://www.rei.com/learn/expert-advice/travel-clothing.html
- S3 REI, 조직·중량·핏에 따른 통기성: https://www.rei.com/learn/expert-advice/how-to-pick-the-most-breathable-fabrics.html
- S4 Levi’s, 면적당 온스와 데님 중량 구간: https://www.levi.com/US/en_US/blog/article/our-complete-guide-to-denim-terminology
- S5 Woolmark, 구김 회복·보관·건조: https://www.woolmark.com/care/care-for-wool/
- S6 Woolmark, 플란넬 마감·축융 수축 방지 가공: https://www.woolmark.com/industry/use-wool/product-innovations/machine-washable-yarn/
- S7 Pertex, 보강사의 인열 강도와 별도 발수 가공: https://pertex.com/fabrics-technologies/quantum
- S8 Woolmark, 게이지와 바늘 수 단위 차이: https://www.woolmark.com/industry/use-wool/wool-processing/worsted-knitting/

CottonWorks/Cotton Incorporated 원문은 접근 제한(403)으로 확인하지 못했으므로 근거로 채택하지 않았다. 수축률·최저가·섬유별 확정 보온 온도는 제공하지 않는다.
