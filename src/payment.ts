import { createHash, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { FashionError, findProduct, skuSchema } from "./catalog";
import type { Catalog, SKU } from "./catalog";
import { loadProfile } from "./profile";
import { saveSelection, withSelection } from "./selection";

const quoteSchema = z.object({
  id: z.string().uuid(),
  digest: z.string(),
  approvalCode: z.string().regex(/^\d{4}$/).optional(),
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
  if (!quote.approvalCode) throw new FashionError("superseded", "이전 견적입니다. 새 견적을 확인하세요.");
  return `승인 ${quote.approvalCode}`;
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
  return withSelection(async (selection, folder) => {
  const product = findProduct(catalog, sku);
  const profile = await loadProfile();
  const now = Date.now();
  const revision = selection.revision + 1;
  if (revision > 9000) throw new FashionError("approval_codes_exhausted", "승인 코드 발급 한도입니다.");
  const payload = {
    id: randomUUID(),
    approvalCode: String(999 + revision),
    sku,
    source: catalog.source,
    referencePriceKrw: product.sample_unit_price_krw,
    profileVersion: profile.decisionVersion,
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
  const file = await open(join(folder, `${quote.id}.json`), "wx", 0o600);
  await file.writeFile(JSON.stringify(quote, null, 2));
  await file.close();
  await saveSelection({
    revision,
    current: { ...selection.current, [judgments.actor]: quote.id },
  }, folder);
  return {
    status: "awaiting_approval",
    summary: `${product.label} · ${quote.option} · 모의 실행`,
    quote,
    approval: approvalText(quote),
    next: "명시 승인 / 보류 / 취소",
  };
  });
}

export async function approveAndPay(
  catalog: Catalog,
  sku: SKU,
  input: { readonly quoteId: string; readonly approval: string; readonly cancel: boolean },
) {
  return withSelection(async (selection, folder) => {
  const quoteId = z.string().uuid().parse(input.quoteId);
  const quote = quoteSchema.parse(await Bun.file(join(folder, `${quoteId}.json`)).json());
  if (quote.sku !== sku || quote.source !== catalog.source) {
    throw new FashionError("quote_mismatch", "다른 상품 또는 데이터 출처의 견적입니다.");
  }
  const receiptPath = join(folder, `${quoteId}.receipt.json`);
  if (await Bun.file(receiptPath).exists()) {
    const receipt = receiptSchema.parse(await Bun.file(receiptPath).json());
    return {
      ...receipt,
      reused: true,
      cancellation: input.cancel && receipt.status === "simulated" ? "not_allowed" : null,
      message: receipt.status === "cancelled" ? "취소됨(모의)"
        : input.cancel ? "실행 후 취소 불가" : "실행됨(모의)",
    };
  }
  if (selection.current[quote.actor] !== quote.id) {
    throw new FashionError("superseded", "이전 견적입니다. 현재 견적을 확인하세요.");
  }
  if (!input.cancel) {
    const product = findProduct(catalog, sku);
    const profile = await loadProfile();
    checkApproval(
      quote,
      input.approval,
      { sku, price: product.sample_unit_price_krw, profileVersion: profile.decisionVersion },
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
  return {
    ...receipt,
    reused: false,
    cancellation: input.cancel ? "cancelled" : null,
    message: input.cancel ? "취소됨(모의)" : "실행됨(모의)",
  };
  });
}
