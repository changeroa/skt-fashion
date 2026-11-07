import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { koreanExplanation } from "./ax";
import { FashionError, loadCatalog, localAsset, priceCard, privateHome, searchCatalog, skuSchema } from "./catalog";
import { approveAndPay, createQuote } from "./payment";
import { fitCard } from "./profile";
import { tryon } from "./tryon";

const folder = join(privateHome(), "demo");
await mkdir(folder, { recursive: true, mode: 0o700 });
const ff = await loadCatalog("F&F sample");
const own = await loadCatalog("own-design");
const request = "8만원 이하 맨투맨";
const explanation = await koreanExplanation(request);
if (explanation.status !== "succeeded") {
  throw new FashionError("oba_unavailable", "A.X 실호출이 완료되지 않아 데모를 완료하지 않았습니다.");
}
if (explanation.filters.budget !== 80000 || explanation.filters.item !== "맨투맨") {
  throw new FashionError("oba_filters", "A.X 조건 추출과 실제 데모 조건이 일치하지 않습니다.");
}
const search = searchCatalog(ff, {
  budget: explanation.filters.budget,
  item: explanation.filters.item,
});
const first = search.candidates[0];
if (!first) throw new FashionError("demo_empty", "실제 카탈로그에서 시연 후보가 없습니다.");
const ffPrice = priceCard(ff, first.product_id, 80000);
const ffFit = await fitCard(ff, first.product_id);
const judged = {
  price: "accepted",
  fit: "accepted-with-unknown-size",
  option: "사이즈 미정 (모의 판단에만 사용)",
  actor: "scripted-demo",
} as const;
const ffQuote = await createQuote(ff, first.product_id, judged);
const ffReceipt = await approveAndPay(ff, first.product_id, {
  quoteId: ffQuote.quote.id,
  approval: ffQuote.approval,
  cancel: false,
});
const ownSku = skuSchema.parse("OWN-001");
// A separate own-design result, never attached as a try-on of the F&F candidate.
const ownFit = await fitCard(own, ownSku);
const ownTryon = await tryon(own, ownSku);
const ownPrice = priceCard(own, ownSku);
const ownQuote = await createQuote(own, ownSku, judged);
const ownReceipt = await approveAndPay(own, ownSku, {
  quoteId: ownQuote.quote.id,
  approval: ownQuote.approval,
  cancel: false,
});
const empty = searchCatalog(ff, { budget: 50000, item: "맨투맨" });
if (empty.status !== "empty") {
  throw new FashionError("edge_changed", "실제 데이터의 5만원 빈 결과 조건이 달라졌습니다.");
}
const flows = [
  {
    name: "price-first",
    request,
    ok: true,
    scope: "non-image",
    order: ["search_catalog", "price_card", "fit_card", "quote", "approve_and_pay"],
    explanation,
    search,
    priceCard: ffPrice,
    fitCard: ffFit,
    quote: ffQuote,
    receipt: ffReceipt,
    tryon: { status: "local-only", notice: "F&F 사진 외부 전송 없음. 자체 디자인 착장과 별개입니다." },
  },
  {
    name: "specific-item",
    request: "OWN-001, 이 자체 디자인 맨투맨이 나에게 맞을까?",
    ok: true,
    scope: "non-image",
    order: ["fit_card", "tryon", "price_card", "quote", "approve_and_pay"],
    fitCard: ownFit,
    tryon: ownTryon,
    priceCard: ownPrice,
    quote: ownQuote,
    receipt: ownReceipt,
  },
];
const report = {
  generatedAt: new Date().toISOString(),
  actor: "scripted-demo",
  notice: "리허설의 판단·승인은 스크립트 입력이며 소유자의 실제 구매 승인 기록이 아닙니다.",
  payment: "simulation",
  transferCount: 0,
  imagesGenerated: ownTryon.status === "succeeded" ? 1 : 0,
  flows,
  edgeCases: { adultSweatshirtsUnder50000: empty },
};
const reportPath = join(folder, "flows.json");
await Bun.write(reportPath, JSON.stringify(report, null, 2));
await chmod(reportPath, 0o600);
const candidateRows = search.candidates.map(
  (p) => `| ${p.product_id} | ${p.label} | ${p.sample_unit_price_krw.toLocaleString("ko-KR")}원 | ${p.color_family} |`,
);
const imageLinks = search.candidates.map(
  (p) => `- [${p.label} 상품 원본 (로컬 전용)](${localAsset(ff.root, p.image)})`,
);
const markdown = `# 입고살까 — 구매 판단 리허설

## 완료 범위

- 가격 탐색, 가격·핏 카드, A.X K2 실호출, 명시 승인, 모의 영수증: 완료.
- 착장 생성: ${ownTryon.status}. 생성되지 않은 착장 이미지를 표시하지 않습니다.
- 결제: simulation, 실제 송금 0회, 실제 의류 주문·배송 없음.
- 아래 수용·선택·승인은 scripted-demo 입력이며 소유자 의사로 기록하지 않습니다.

## 가격 우선: ${request}

F&F v5.3 정적 샘플, 기준 ${ff.asOf}. 아래 가격은 설정된 참고가격이며 실제 판매가가 아닙니다.

| 상품 ID | 상품 별칭 | 참고가격 | 색 |
|---|---|---:|---|
${candidateRows.join("\n")}

${imageLinks.join("\n")}

### A. 가격 카드

선택 후보: ${first.label} (${first.product_id}).
참고가격 기준 예산 차이: ${ffPrice.budgetRemainingOnReferenceOnly?.toLocaleString("ko-KR")}원.
배송비·세금·할인·가격 이력·반품비 미확인. 최종 총액 미확정. 최저가나 실제 할인이라고 주장하지 않습니다.
사용자 선택: 가격 납득 / 대안 보기 / 판단 보류.

### B. 적합성 카드

${ffFit.styleEvidence}
${ffFit.pastPreferences}. 평소 사이즈·핏 선호가 제공되지 않았습니다.
실측표가 없으므로 **${ffFit.sizing}**. 사진으로 치수를 추정하지 않습니다.
F&F 사진은 로컬에서만 표시하며 OpenAI나 A.X에 전송하지 않습니다.
사용자 선택: 선호 / 다른 옵션 / 사이즈 확인 / 보류.

### C. 최종 모의 승인

견적 ID: ${ffQuote.quote.id}
상품: ${first.product_id}, 옵션: ${ffQuote.quote.option}, 수량 1.
프로필 버전: ${ffQuote.quote.profileVersion}.
모드 simulation. 수취인 없음, 체인 없음, 전송액 0 tOKRW, 수수료 0.
실제 구매 승인은 불가하며 모의 실행만 명시 승인할 수 있습니다.
리허설 승인: \`${ffQuote.approval}\`

### D. 결과

상태: ${ffReceipt.status}. 송금 0회, 거래 해시 없음, 주문·배송 없음.
준비된 MAWS 인증·에이전트·수취인·수수료 집행 조건을 확보하지 못해 모의 모드를 사용합니다.

### A.X K2 실제 응답

${explanation.explanation}

A.X에는 일반 요청 "${request}"만 보냈습니다. F&F 상품 정보·이미지와 개인 프로필은 보내지 않았습니다.

## 특정 상품: OWN-001

자체 제작한 네이비 맨투맨 디자인 그림입니다. F&F 상품과 무관하며 판매하지 않는 가상 상품입니다.
전체 카탈로그 재추천 없이 적합성 카드부터 확인합니다.

- B: ${ownFit.sizing}. ${ownFit.pastPreferences}.
- 착장: **${ownTryon.status}**. 전신 정면과 안경 얼굴 사진 두 장만 동의 범위입니다.
- A: 설정 참고가격 ${ownPrice.referencePriceKrw.toLocaleString("ko-KR")}원. 실제 총 구매액은 미확인.
- C: 모의 견적 ${ownQuote.quote.id}. scripted-demo 명시 승인.
- D: ${ownReceipt.status}, 송금 0회.

자체 의류의 착장이 생성돼도 F&F 후보의 착장으로 연결하지 않습니다.

## 빈 결과 검증

"5만원 이하 맨투맨"의 성인 후보: ${empty.matchedCount}개.
아동 상품을 성인에게 추천하지 않으며 참고가격을 낮춰 만들지 않습니다.
다음 행동은 예산 수정 / 다른 종류 / 종료입니다.

## 보관

F&F 데이터·로컬 카드·해당 파생 결과는 행사 종료 후 삭제 대상입니다.
원본 인물 사진은 이 정리 대상과 별개이며 자동 삭제하지 않습니다.
`;
await Bun.write(join(folder, "demo.md"), markdown);
await chmod(join(folder, "demo.md"), 0o600);
console.log(JSON.stringify({
  status: "non-image-demo-complete",
  reportPath,
  markdown: join(folder, "demo.md"),
  flows: flows.map((f) => ({ name: f.name, ok: f.ok, scope: f.scope })),
  tryon: ownTryon.status,
  payment: "simulation",
  transferCount: 0,
}, null, 2));
