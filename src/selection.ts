import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { FashionError, privateHome } from "./catalog";

const selectionSchema = z.object({
  revision: z.number().int().nonnegative(),
  current: z.object({
    user: z.string().uuid().nullable(),
    "scripted-demo": z.string().uuid().nullable(),
  }),
});
export type Selection = z.infer<typeof selectionSchema>;

// The lock covers both selection updates and receipt creation across CLI processes.
export async function withSelection<T>(action: (state: Selection, folder: string) => Promise<T>) {
  const folder = join(privateHome(), "demo/quotes");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const lockPath = join(folder, "selection.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new FashionError("selection_busy", "선택 처리 중입니다. 완료 후 다시 시도하세요.");
    }
    throw error;
  }
  try {
    const file = Bun.file(join(folder, "selection.json"));
    const state = await file.exists()
      ? selectionSchema.parse(await file.json())
      : { revision: 0, current: { user: null, "scripted-demo": null } };
    return await action(state, folder);
  } finally {
    await lock.close();
    await rm(lockPath);
  }
}

export async function saveSelection(state: Selection, folder: string) {
  await Bun.write(join(folder, "selection.json"), JSON.stringify(state), { mode: 0o600 });
}

export async function clearSelection(actor: "user" | "scripted-demo") {
  return withSelection(async (state, folder) => {
    await saveSelection({ ...state, current: { ...state.current, [actor]: null } }, folder);
    return { status: "selection_changed", next: "새 옵션의 가격·핏 판단 후 견적 받기" };
  });
}
