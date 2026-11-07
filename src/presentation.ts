import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { privateHome } from "./catalog";

export async function sessionLimits(session: string) {
  const folder = join(privateHome(), "demo/sessions");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const key = createHash("sha256").update(session).digest("hex");
  try {
    const file = await open(join(folder, `${key}.notice`), "wx", 0o600);
    await file.close();
    return ["참고가격·예상 착장으로 판단하며 사이즈는 별도 확인합니다. 실행은 모의입니다."];
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return [];
    throw error;
  }
}
