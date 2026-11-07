import ky, { HTTPError } from "ky";
import { z } from "zod";
import { FashionError } from "./catalog";

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});
const filtersSchema = z.object({
  budget: z.number().finite().nonnegative().nullable(),
  category: z.string().nullable(),
  item: z.string().nullable(),
});

export async function koreanExplanation(request: string) {
  const keyFile = process.env["OBA_KEY_FILE"];
  if (!keyFile) return { status: "키 대기", provider: "none" } as const;
  const key = (await Bun.file(keyFile).text()).trim();
  if (!key) throw new FashionError("oba_key_empty", "A.X 키 파일이 비어 있습니다.");
  try {
    // Only the user's generic query leaves this host. No F&F records or profile fields.
    const response = await ky
      .post("https://agent-os-biz.adot.ai/oba/v1/chat/completions", {
        retry: 0,
        timeout: 60000,
        headers: { Authorization: `Bearer ${key}` },
        json: {
          model: "skt/a.ll/A.X-K2-ADOT",
          messages: [
            {
              role: "system",
              content:
                '한국어 의류 요청의 검색 조건만 추출하세요. JSON {"filters":{"budget":숫자 또는 null,"category":문자열 또는 null,"item":문자열 또는 null},"explanation":문자열}만 반환하세요. 금액은 원 단위, 맨투맨은 category="top", item="맨투맨". explanation은 "조건에 맞는 로컬 후보를 확인할게요."처럼 다음 행동 한 문장만. 상품·가격·재고를 만들거나 추천 불가능·직접 확인 같은 제한을 반복하지 마세요. 이미지를 보았다고 하지 마세요.',
            },
            { role: "user", content: request },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        },
      })
      .json<unknown>();
    const parsed = completionSchema.parse(response);
    const first = parsed.choices[0];
    if (!first) throw new FashionError("oba_response", "A.X 응답이 비어 있습니다.");
    const content = z
      .object({ filters: filtersSchema, explanation: z.string().min(1) })
      .parse(JSON.parse(first.message.content));
    return {
      status: "succeeded",
      provider: "A.X K2",
      model: "skt/a.ll/A.X-K2-ADOT",
      sent: "generic-user-query-only",
      ...content,
    } as const;
  } catch (error) {
    if (error instanceof HTTPError) {
      throw new FashionError("oba_http", `A.X 응답 HTTP ${error.response.status}`);
    }
    throw error;
  }
}
