import { parseArgs } from "node:util";
import { join } from "node:path";
import { z } from "zod";
import { koreanExplanation } from "./ax";
import { FashionError, loadCatalog, priceCard, privateHome, searchCatalog, skuSchema } from "./catalog";
import { approveAndPay, createQuote } from "./payment";
import { fitCard } from "./profile";
import { tryon } from "./tryon";
import { clearSelection } from "./selection";
import { sessionLimits } from "./presentation";

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    source: { type: "string", default: "ff" },
    budget: { type: "string" },
    category: { type: "string" },
    item: { type: "string" },
    sku: { type: "string" },
    request: { type: "string" },
    quote: { type: "string" },
    approval: { type: "string" },
    price: { type: "string" },
    fit: { type: "string" },
    option: { type: "string" },
    cancel: { type: "boolean", default: false },
    actor: { type: "string", default: "user" },
    session: { type: "string" },
    observation: { type: "string" },
  },
});

async function main() {
  const command = positionals[0];
  const actor = z.enum(["user", "scripted-demo"]).parse(values.actor);
  if (command === "change_selection") return clearSelection(actor);
  if (command === "explain") {
    return koreanExplanation(z.string().min(1).parse(values.request));
  }
  const source = z.enum(["ff", "own"]).parse(values.source);
  const catalog = await loadCatalog(source === "ff" ? "F&F sample" : "own-design");
  if (command === "search_catalog") {
    return searchCatalog(catalog, {
      budget: z.coerce.number().finite().nonnegative().parse(values.budget),
      ...(values.category ? { category: values.category } : {}),
      ...(values.item ? { item: values.item } : {}),
    });
  }
  const sku = skuSchema.parse(values.sku);
  switch (command) {
    case "price_card": {
      const price = priceCard(catalog, sku, values.budget === undefined ? undefined : z.coerce.number().finite().nonnegative().parse(values.budget));
      const observation = values.observation ?? join(privateHome(), `demo/${sku}.style.json`);
      if (await Bun.file(observation).exists()) {
        const fit = await fitCard(catalog, sku, observation);
        return { ...price, fabricOpinion: fit.fabricValueOpinion, fabricBasis: fit.fabricBasis, fabricRuleIds: fit.fabricRuleIds };
      }
      return price;
    }
    case "fit_card":
      return fitCard(catalog, sku, values.observation);
    case "tryon":
      return tryon(catalog, sku);
    case "quote":
      return createQuote(catalog, sku, {
        price: z.literal("accepted").parse(values.price),
        fit: z.literal("accepted-with-unknown-size").parse(values.fit),
        option: z.string().min(1).parse(values.option),
        actor,
      });
    case "approve_and_pay":
      return approveAndPay(catalog, sku, {
        quoteId: z.string().uuid().parse(values.quote),
        approval: values.approval ?? "",
        cancel: values.cancel,
      });
    default:
      throw new FashionError("command", "명령: search_catalog, price_card, fit_card, tryon, explain, quote, approve_and_pay");
  }
}

try {
  const result = await main();
  const session = values.session ?? process.env["FASHION_SESSION"];
  console.log(JSON.stringify({
    ...result,
    ...(session ? { sessionLimits: await sessionLimits(session) } : {}),
  }, null, 2));
} catch (error) {
  if (error instanceof FashionError) {
    console.error(JSON.stringify({ status: "error", code: error.code, message: error.message }));
  } else if (error instanceof z.ZodError) {
    console.error(JSON.stringify({ status: "invalid_input", fields: error.issues.map((i) => i.path) }));
  } else if (error instanceof Error) {
    console.error(JSON.stringify({ status: "error", type: error.name, message: "실행 실패. 비밀값을 출력하지 않았습니다." }));
  } else {
    throw error;
  }
  process.exitCode = 1;
}
