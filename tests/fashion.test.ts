import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { localAsset, priceCard, searchCatalog, skuSchema } from "../src/catalog";
import type { Catalog } from "../src/catalog";
import { approvalText, checkApproval, quoteDigest } from "../src/payment";
import type { Quote } from "../src/payment";

const sku = skuSchema.parse("TOP-001");
const catalog: Catalog = {
  source: "F&F sample",
  root: "/fixture",
  asOf: "2026-11-07T10:00:00+09:00",
  products: [
    { product_id: sku, label: "성인 맨투맨", category: "top", color_family: "navy", product_type: "맨투맨", age_group: "adult", sample_unit_price_krw: 70000, image: "a.png" },
    { product_id: skuSchema.parse("TOP-002"), label: "아동 맨투맨", category: "top", color_family: "cream", product_type: "맨투맨", age_group: "kids", sample_unit_price_krw: 40000, image: "b.png" },
    { product_id: skuSchema.parse("TOP-003"), label: "성인 맨투맨 B", category: "top", color_family: "gray", product_type: "맨투맨", age_group: "adult", sample_unit_price_krw: 75000, image: "c.png" },
  ],
};

describe("catalog", () => {
  test("returns adult reference-price candidates in budget order", () => {
    // Given
    const input = { budget: 80000, item: "맨투맨" };
    // When
    const result = searchCatalog(catalog, input);
    // Then
    expect(result.candidates.map((p) => p.sample_unit_price_krw)).toEqual([70000, 75000]);
    expect(result.finalTotalKnown).toBe(false);
  });
  test("returns empty rather than recommending children under the adult budget", () => {
    // Given
    const input = { budget: 50000, item: "맨투맨" };
    // When
    const result = searchCatalog(catalog, input);
    // Then
    expect(result.status).toBe("empty");
    expect(result.matchedCount).toBe(0);
  });
  test("does not convert unknown shipping and tax to a confirmed total", () => {
    // Given
    const budget = 80000;
    // When
    const card = priceCard(catalog, sku, budget);
    // Then
    expect(card.finalTotalKrw).toBeNull();
    expect(card.shippingKrw).toBeNull();
    expect(card.budgetRemainingOnReferenceOnly).toBe(10000);
    expect(card.approvalForRealPurchase).toBe(false);
    expect(card.alternatives.map((p) => p.product_id)).toEqual([skuSchema.parse("TOP-003")]);
  });
  test("rejects assets escaping the designated catalog", () => {
    // Given
    const relative = "../private.key";
    // When / Then
    expect(() => localAsset("/fixture", relative)).toThrow();
  });
});

const quotePayload: Omit<Quote, "digest"> = {
  id: "0980c30a-1df1-4407-890d-12ec1680540e",
  approvalCode: "1001",
  sku,
  source: "F&F sample",
  referencePriceKrw: 70000,
  profileVersion: "v1",
  option: "size-unknown",
  quantity: 1,
  priceJudgment: "accepted",
  fitJudgment: "accepted-with-unknown-size",
  actor: "scripted-demo",
  mode: "simulation",
  recipient: "simulation:no-recipient",
  chainId: null,
  transferAmount: "0",
  currency: "tOKRW",
  feeCap: "0",
  realOrder: false,
  createdAt: "2026-11-07T04:00:00.000Z",
  expiresAt: "2026-11-07T04:15:00.000Z",
};
const quote: Quote = { ...quotePayload, digest: quoteDigest(quotePayload) };
const current = { sku, price: 70000, profileVersion: "v1" };
const validTime = Date.parse("2026-11-07T04:05:00.000Z");

describe("approval binding", () => {
  test("accepts only exact approval of the current unchanged quote", () => {
    // Given
    const approval = approvalText(quote);
    // When / Then
    expect(() => checkApproval(quote, approval, current, validTime)).not.toThrow();
  });
  test("rejects an ambiguous positive response", () => {
    // Given
    const approval = "좋네";
    // When / Then
    expect(() => checkApproval(quote, approval, current, validTime)).toThrow();
  });
  test("invalidates approval after a price change", () => {
    // Given
    const changed = { ...current, price: 74000 };
    // When / Then
    expect(() => checkApproval(quote, approvalText(quote), changed, validTime)).toThrow();
  });
  test("invalidates approval after a profile change", () => {
    // Given
    const changed = { ...current, profileVersion: "v2" };
    // When / Then
    expect(() => checkApproval(quote, approvalText(quote), changed, validTime)).toThrow();
  });
  test("rejects an expired quote without timing luck", () => {
    // Given
    const expired = Date.parse(quote.expiresAt);
    // When / Then
    expect(() => checkApproval(quote, approvalText(quote), current, expired)).toThrow();
  });
  test("detects a changed option even if the approval string is unchanged", () => {
    // Given
    const changed = { ...quote, option: "different-size" };
    // When / Then
    expect(() => checkApproval(changed, approvalText(quote), current, validTime)).toThrow();
  });
});

let home: string;
const responseSchema = z.object({ status: z.string() }).passthrough();
async function command(args: readonly string[]) {
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli.ts"), ...args], {
    env: { ...process.env, FASHION_HOME: home, OPENAI_KEY_REF: "", OBA_KEY_FILE: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  const data: unknown = JSON.parse(code === 0 ? stdout : stderr);
  return { code, data };
}
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "fashion-test-"));
  const body = join(home, "body.jpg");
  const face = join(home, "face.jpg");
  // Bytes stay local and are never submitted to an image service.
  await Bun.write(body, "test-reference");
  await Bun.write(face, "test-reference");
  await Bun.write(join(home, "profile/body-profile.json"), JSON.stringify({
    updated: "2026-11-07", sizes: null, fitPreference: null,
    photos: [{ slot: "body_front", file: body, status: "usable" }, { slot: "face_45", file: face, status: "usable" }],
  }));
  await Bun.write(join(home, "tryon-consent.json"), JSON.stringify({
    id: "test-only", provider: "OpenAI", slots: ["body_front", "face_45"], garmentSource: "own-design", maxRequests: 1,
  }));
});
afterAll(async () => { await rm(home, { recursive: true, force: true }); });

describe("real CLI", () => {
  test("reports key waiting without generating images or reserving an API attempt", async () => {
    // Given
    const args = ["tryon", "--source", "own", "--sku", "OWN-001"];
    // When
    const result = await command(args);
    // Then
    expect(result.code).toBe(0);
    expect(responseSchema.parse(result.data).status).toBe("키 대기");
    expect(await readdir(join(home, "demo"))).toEqual([]);
  });
  test("requires the user's price and fit judgments before quoting", async () => {
    // Given
    const args = ["quote", "--source", "own", "--sku", "OWN-001", "--option", "unknown"];
    // When
    const result = await command(args);
    // Then
    expect(result.code).toBe(1);
    expect(responseSchema.parse(result.data).status).toBe("invalid_input");
  });
  test("persists one simulation receipt and reuses it on duplicate approval", async () => {
    // Given
    const created = await command(["quote", "--source", "own", "--sku", "OWN-001", "--price", "accepted", "--fit", "accepted-with-unknown-size", "--option", "unknown"]);
    const pending = z.object({ approval: z.string(), quote: z.object({ id: z.string() }) }).parse(created.data);
    const args = ["approve_and_pay", "--source", "own", "--sku", "OWN-001", "--quote", pending.quote.id, "--approval", pending.approval];
    await command(args);
    // When
    const repeat = await command(args);
    // Then
    const receipt = z.object({ status: z.string(), transferCount: z.number(), reused: z.boolean(), transactionHash: z.null() }).parse(repeat.data);
    expect(receipt.status).toBe("simulated");
    expect(receipt.transferCount).toBe(0);
    expect(receipt.reused).toBe(true);
  });
  test("keeps a cancelled quote cancelled on later approval", async () => {
    // Given
    const created = await command(["quote", "--source", "own", "--sku", "OWN-001", "--price", "accepted", "--fit", "accepted-with-unknown-size", "--option", "unknown"]);
    const pending = z.object({ approval: z.string(), quote: z.object({ id: z.string() }) }).parse(created.data);
    await command(["approve_and_pay", "--source", "own", "--sku", "OWN-001", "--quote", pending.quote.id, "--cancel"]);
    // When
    const later = await command(["approve_and_pay", "--source", "own", "--sku", "OWN-001", "--quote", pending.quote.id, "--approval", pending.approval]);
    // Then
    expect(responseSchema.parse(later.data).status).toBe("cancelled");
  });
});
