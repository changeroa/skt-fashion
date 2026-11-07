import { createHash } from "node:crypto";
import { chmod, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import ky, { HTTPError } from "ky";
import { z } from "zod";
import { FashionError, findProduct, localAsset, privateHome } from "./catalog";
import type { Catalog, SKU } from "./catalog";
import { loadProfile } from "./profile";

const consentSchema = z.object({
  id: z.string().min(1),
  provider: z.literal("OpenAI"),
  slots: z.tuple([z.literal("body_front"), z.literal("face_45")]),
  garmentSource: z.literal("own-design"),
  maxRequests: z.number().int().positive(),
});
const outputSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1) })).min(1),
});
const resultSchema = z.object({
  status: z.literal("succeeded"),
  sku: z.string(),
  image: z.string(),
  profileVersion: z.string(),
  fingerprint: z.string(),
  model: z.string(),
  requestId: z.string().nullable(),
});

export async function tryon(catalog: Catalog, sku: SKU) {
  const product = findProduct(catalog, sku);
  if (catalog.source !== "own-design") {
    return { status: "rights_required", sku, notice: "F&F 사진은 로컬 표시만 허용합니다. 외부 전송하지 않았습니다." };
  }
  const demo = join(privateHome(), "demo");
  await mkdir(demo, { recursive: true, mode: 0o700 });
  const consentFile = Bun.file(join(privateHome(), "tryon-consent.json"));
  if (!(await consentFile.exists())) {
    return { status: "consent_required", sku, notice: "body_front + face_45의 OpenAI 전송 동의가 필요합니다." };
  }
  const consent = consentSchema.parse(await consentFile.json());
  const profile = await loadProfile();
  const photos = consent.slots.map((slot) => {
    const photo = profile.photos.find((p) => p.slot === slot && p.status === "usable");
    if (!photo) throw new FashionError("photo_missing", `${slot} 사진이 없습니다.`);
    return photo.file;
  });
  const garment = localAsset(catalog.root, product.image);
  const hasher = createHash("sha256").update(`${sku}:${profile.version}:prompt-v1`);
  for (const file of [...photos, garment]) hasher.update(new Uint8Array(await Bun.file(file).arrayBuffer()));
  const fingerprint = hasher.digest("hex");
  const stem = `${sku}-${fingerprint.slice(0, 12)}`;
  const receiptPath = join(demo, `${stem}.json`);
  if (await Bun.file(receiptPath).exists()) {
    const result = resultSchema.parse(await Bun.file(receiptPath).json());
    if (result.fingerprint !== fingerprint || !(await Bun.file(result.image).exists())) {
      throw new FashionError("cache_invalid", "캐시와 입력이 일치하지 않습니다.");
    }
    return { ...result, cached: true };
  }
  const reference = process.env["OPENAI_KEY_REF"];
  if (!reference) return { status: "키 대기", sku, notice: "OpenAI 호출 0회. 1Password 키 참조가 필요합니다." };
  const ref = /^op:\/\/claw\/([^/]+)\/([^/]+)$/.exec(reference);
  const item = ref?.[1];
  const field = ref?.[2];
  if (!item || !field) throw new FashionError("key_source", "op://claw/항목ID/필드 형식만 허용합니다.");
  const keyProcess = Bun.spawn(
    [
      "bash", "-lc",
      'set -e; source "$HOME/.config/openclaw/1password.env"; test -n "$OP_SERVICE_ACCOUNT_TOKEN"; exec op item get "$1" --vault claw --fields "$2" --reveal',
      "fashion-key", decodeURIComponent(item), decodeURIComponent(field),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const key = (await new Response(keyProcess.stdout).text()).trim();
  await new Response(keyProcess.stderr).text();
  if ((await keyProcess.exited) !== 0 || !key) {
    return { status: "키 대기", sku, notice: "claw 키를 읽지 못했습니다. OpenAI 호출 0회." };
  }
  const raster = join(demo, `${sku}-garment.png`);
  const render = Bun.spawn(["sips", "-s", "format", "png", garment, "--out", raster], {
    stdout: "ignore",
    stderr: "pipe",
  });
  await new Response(render.stderr).text();
  if ((await render.exited) !== 0 || !(await Bun.file(raster).exists())) {
    throw new FashionError("garment_render", "자체 의류 그림을 PNG로 변환하지 못했습니다.");
  }
  await chmod(raster, 0o600);
  const form = new FormData();
  form.set("model", "gpt-image-2.5-sunburst");
  form.set("n", "1");
  form.set("size", "1024x1536");
  form.set("quality", "medium");
  form.set("output_format", "webp");
  form.set(
    "prompt",
    "Create a realistic virtual try-on of this consenting adult. Image 1 is the full-body front reference; image 2 is the same person's clear face with glasses; image 3 is our original fictional garment design, NOT an F&F product. Preserve the person's face, hairstyle, glasses, body proportions, skin tone, pose, hands, legs and room background. Replace only the upper-body clothing with a realistic plain crewneck sweatshirt matching image 3's exact color, neckline, ribbed cuffs and hem, without logos or extra decoration. Keep the whole person visible, including feet. Remove phone screenshot interface bars outside the photo. Do not slim or reshape the body or beautify the face. This is a style illustration, not a measurement or fit guarantee.",
  );
  for (const [index, file] of [...photos, raster].entries()) {
    const blob = Bun.file(file);
    form.append("image[]", blob, `reference-${index + 1}.${file.endsWith(".png") ? "png" : "jpg"}`);
  }
  // Atomic per-input claim prevents parallel calls or a restarted process from rebilling.
  const claim = join(demo, `${stem}.attempt`);
  let handle;
  try {
    handle = await open(claim, "wx", 0o600);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return { status: "unknown", sku, notice: "기존 실행 기록이 있습니다. 자동 재생성하지 않습니다." };
    }
    throw error;
  }
  await handle.writeFile(JSON.stringify({ sku, fingerprint, consentId: consent.id, status: "reserved" }));
  await handle.close();
  const budgetClaim = join(demo, `consent-${createHash("sha256").update(consent.id).digest("hex").slice(0, 12)}`);
  await mkdir(budgetClaim, { recursive: true, mode: 0o700 });
  let reserved = false;
  for (let index = 0; index < consent.maxRequests; index++) {
    try {
      const slot = await open(join(budgetClaim, `${index}.attempt`), "wx", 0o600);
      await slot.writeFile(JSON.stringify({ sku, fingerprint }));
      await slot.close();
      reserved = true;
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
  }
  if (!reserved) return { status: "consent_exhausted", sku, notice: "승인한 생성 횟수를 사용했습니다. 새 승인 필요." };
  try {
    const response = await ky.post("https://api.openai.com/v1/images/edits", {
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      timeout: 240000,
      retry: 0,
    });
    const result = outputSchema.parse(await response.json<unknown>());
    const first = result.data[0];
    if (!first) throw new FashionError("image_empty", "이미지 응답이 비어 있습니다.");
    const image = join(demo, `${stem}.webp`);
    await Bun.write(image, Buffer.from(first.b64_json, "base64"));
    await chmod(image, 0o600);
    const receipt = {
      status: "succeeded",
      sku,
      image,
      profileVersion: profile.version,
      fingerprint,
      model: "gpt-image-2.5-sunburst",
      requestId: response.headers.get("x-request-id"),
    } as const;
    await Bun.write(receiptPath, JSON.stringify(receipt, null, 2));
    await chmod(receiptPath, 0o600);
    return { ...receipt, cached: false };
  } catch (error) {
    if (error instanceof HTTPError) {
      return { status: "failed", sku, httpStatus: error.response.status, notice: "이미지 API 실패. 재시도하지 않았습니다." };
    }
    if (error instanceof Error) {
      return { status: "unknown", sku, error: error.name, notice: "생성 결과 확인 필요. 자동 재시도하지 않습니다." };
    }
    throw error;
  }
}
