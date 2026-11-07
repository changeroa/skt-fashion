import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

let home: string;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "fashion-payment-"));
  await Bun.write(join(home, "profile/body-profile.json"), JSON.stringify({
    updated: "2026-11-07", sizes: null, fitPreference: null, photos: [],
  }));
});
afterAll(async () => { await rm(home, { recursive: true, force: true }); });

async function cli(args: readonly string[]) {
  const process = Bun.spawn([Bun.which("bun") ?? "bun", join(import.meta.dir, "../src/cli.ts"), ...args], {
    env: { ...Bun.env, FASHION_HOME: home }, stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
  ]);
  return { exit, data: JSON.parse(exit === 0 ? stdout : stderr) as unknown };
}
const pendingSchema = z.object({ approval: z.string(), quote: z.object({ id: z.string() }) });
async function quote(option: string, actor = "scripted-demo") {
  const result = await cli(["quote", "--source", "own", "--sku", "OWN-001",
    "--price", "accepted", "--fit", "accepted-with-unknown-size", "--option", option, "--actor", actor]);
  return pendingSchema.parse(result.data);
}
type Pending = z.infer<typeof pendingSchema>;
async function approve(pending: Pending, cancel = false) {
  return cli(["approve_and_pay", "--source", "own", "--sku", "OWN-001",
    "--quote", pending.quote.id, ...(cancel ? ["--cancel"] : ["--approval", pending.approval])]);
}
const errorSchema = z.object({ code: z.string() });
const receiptSchema = z.object({ status: z.string(), reused: z.boolean(), cancellation: z.string().nullable() });

test("rejects the old quote when a new option has superseded it", async () => {
  // Given
  const old = await quote("M");
  await quote("L");
  // When
  const result = await approve(old);
  // Then
  expect(errorSchema.parse(result.data).code).toBe("superseded");
});

test("invalidates an old quote immediately when selection changes before requoting", async () => {
  // Given
  const old = await quote("M");
  await cli(["change_selection", "--actor", "scripted-demo"]);
  // When
  const result = await approve(old);
  // Then
  expect(errorSchema.parse(result.data).code).toBe("superseded");
});

test("rejects a previous short code against the new quote", async () => {
  // Given
  const old = await quote("M");
  const current = await quote("L");
  // When
  const result = await approve({ ...current, approval: old.approval });
  // Then
  expect(errorSchema.parse(result.data).code).toBe("approval_required");
});

test("executes the current four-digit explicit approval", async () => {
  // Given
  const current = await quote("L");
  expect(current.approval).toMatch(/^승인 \d{4}$/);
  // When
  const result = await approve(current);
  // Then
  expect(receiptSchema.parse(result.data).status).toBe("simulated");
});

test("reports cancellation as refused after execution without rewriting the receipt", async () => {
  // Given
  const current = await quote("M");
  await approve(current);
  // When
  const result = await approve(current, true);
  // Then
  expect(receiptSchema.parse(result.data)).toEqual({
    status: "simulated", reused: true, cancellation: "not_allowed",
  });
});

test("keeps a pending cancellation terminal on approval replay", async () => {
  // Given
  const current = await quote("M");
  await approve(current, true);
  // When
  const result = await approve(current);
  // Then
  expect(receiptSchema.parse(result.data).status).toBe("cancelled");
});

test("does not supersede a user quote with a scripted demo", async () => {
  // Given
  const user = await quote("M", "user");
  await quote("L");
  // When
  const result = await approve(user);
  // Then
  expect(receiptSchema.parse(result.data).status).toBe("simulated");
});

test("shows common limits once per explicit conversation session", async () => {
  // Given
  const first = await cli(["fit_card", "--source", "own", "--sku", "OWN-001", "--session", "a"]);
  const schema = z.object({ sessionLimits: z.array(z.string()) });
  expect(schema.parse(first.data).sessionLimits).toHaveLength(1);
  // When
  const second = await cli(["price_card", "--source", "own", "--sku", "OWN-001", "--session", "a"]);
  // Then
  expect(schema.parse(second.data).sessionLimits).toEqual([]);
});

test("shows common limits again in a different conversation session", async () => {
  // Given
  await cli(["fit_card", "--source", "own", "--sku", "OWN-001", "--session", "old"]);
  // When
  const fresh = await cli(["fit_card", "--source", "own", "--sku", "OWN-001", "--session", "new"]);
  // Then
  expect(z.object({ sessionLimits: z.array(z.string()) }).parse(fresh.data).sessionLimits).toHaveLength(1);
});
