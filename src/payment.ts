import { createHash, randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { FashionError, findProduct, privateHome, skuSchema } from "./catalog";
import type { Catalog, SKU } from "./catalog";
import { loadProfile } from "./profile";

const quoteSchema = z.object({
  id: z.string().uuid(),
  digest: z.string(),
  sku: skuSchema,
  source: z.enum(["F&F sample", "own-design"]),
  referencePriceKrw: z.number(),
  profileVersion: z.string(),
  option: z.string().min(1),
  quantity: z.literal(1),
  priceJudgment: z.literal("accepted"),
  fitJudgment: z.literal("accepted-with-unknown-size"),
  actor: z.enum(["user", "scripted-demo"]),
  mode: z.literal("simulation"),
  recipient: z.literal("simulation:no-recipient"),
  chainId: z.null(),
  transferAmount: z.literal("0"),
  currency: z.literal("tOKRW"),
  feeCap: z.literal("0"),
  realOrder: z.literal(false),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type Quote = Readonly<z.infer<typeof quoteSchema>>;
const receiptSchema = z.object({
  quoteId: z.string().uuid(),
  digest: z.string(),
  status: z.enum(["simulated", "cancelled"]),
  transferCount: z.literal(0),
  transactionHash: z.null(),
  realOrder: z.literal(false),
  actor: z.enum(["user", "scripted-demo"]),
});

export function quoteDigest(value: Omit<Quote, "digest">): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

export function approvalText(quote: Quote): string {
  return `모의 승인 ${quote.id} ${quote.digest}`;
}

export function checkApproval(
  quote: Quote,
  text: string,
  current: { readonly sku: SKU; readonly price: number; readonly profileVersion: string },
  now: number,
) {
  const { digest, ...payload } = quote;
  if (digest !== quoteDigest(payload)) throw new FashionError("quote_changed", "견적 내용이 변경됐습니다.");
  if (text !== approvalText(quote)) throw new FashionError("approval_required", "현재 견적의 정확한 명시 승인이 필요합니다.");
  if (
    quote.sku !== current.sku ||
    quote.referencePriceKrw !== current.price ||
    quote.profileVersion !== current.profileVersion ||
    now >= Date.parse(quote.expiresAt)
  ) {
    throw new FashionError("stale_quote", "상품·가격·프로필 또는 유효 시간이 변경됐습니다. 새 견적과 새 승인 필요.");
  }
}

export async function createQuote(
  catalog: Catalog,
  sku: SKU,
  judgments: {
    readonly price: "accepted";
    readonly fit: "accepted-with-unknown-size";
    readonly option: string;
    readonly actor: "user" | "scripted-demo";
  },
) {
  const product = findProduct(catalog, sku);
  const profile = await loadProfile();
  const now = Date.now();
  const payload = {
    id: randomUUID(),
    sku,
    source: catalog.source,
    referencePriceKrw: product.sample_unit_price_krw,
    profileVersion: profile.version,
    option: judgments.option,
    quantity: 1,
    priceJudgment: judgments.price,
    fitJudgment: judgments.fit,
    actor: judgments.actor,
    mode: "simulation",
    recipient: "simulation:no-recipient",
    chainId: null,
    transferAmount: "0",
    currency: "tOKRW",
    feeCap: "0",
    realOrder: false,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
  } as const;
  const quote = quoteSchema.parse({ ...payload, digest: quoteDigest(payload) });
  const folder = join(privateHome(), "demo/quotes");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const file = await open(join(folder, `${quote.id}.json`), "wx", 0o600);
  await file.writeFile(JSON.stringify(quote, null, 2));
  await file.close();
  return {
    status: "awaiting_approval",
    quote,
    approval: approvalText(quote),
    notice: "모의 결제 전용. 실제 주문·배송·서명·송금 0회. 사이즈와 최종 구매 총액은 미확인입니다.",
    reason: "준비된 MAWS 인증·에이전트·수취인·수수료 집행 조건이 없어 실제 전송을 연결하지 않았습니다.",
    next: "명시 승인 / 보류 / 취소",
  };
}

export async function approveAndPay(
  catalog: Catalog,
  sku: SKU,
  input: { readonly quoteId: string; readonly approval: string; readonly cancel: boolean },
) {
  const quoteId = z.string().uuid().parse(input.quoteId);
  const folder = join(privateHome(), "demo/quotes");
  const quote = quoteSchema.parse(await Bun.file(join(folder, `${quoteId}.json`)).json());
  if (quote.sku !== sku || quote.source !== catalog.source) {
    throw new FashionError("quote_mismatch", "다른 상품 또는 데이터 출처의 견적입니다.");
  }
  const receiptPath = join(folder, `${quoteId}.receipt.json`);
  if (await Bun.file(receiptPath).exists()) {
    return { ...receiptSchema.parse(await Bun.file(receiptPath).json()), reused: true };
  }
  if (!input.cancel) {
    const product = findProduct(catalog, sku);
    const profile = await loadProfile();
    checkApproval(
      quote,
      input.approval,
      { sku, price: product.sample_unit_price_krw, profileVersion: profile.version },
      Date.now(),
    );
  }
  const receipt = {
    quoteId,
    digest: quote.digest,
    status: input.cancel ? "cancelled" : "simulated",
    transferCount: 0,
    transactionHash: null,
    realOrder: false,
    actor: quote.actor,
  } as const;
  // Exclusive creation is the one terminal state transition. No payment network is called.
  const file = await open(receiptPath, "wx", 0o600);
  await file.writeFile(JSON.stringify(receipt, null, 2));
  await file.close();
  return { ...receipt, reused: false };
}
