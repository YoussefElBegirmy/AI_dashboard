import { Router } from "express";
import { listModels } from "../engine/openrouter";
import { requireUser } from "../middleware/auth";

export const openRouterRouter = Router();
openRouterRouter.use(requireUser);

/** Proxy of OpenRouter's public model catalog (for the model picker). */
openRouterRouter.get("/models", async (_req, res) => {
  const models = (await listModels()) as { id: string; name: string; context_length?: number; pricing?: Record<string, string>; supported_parameters?: string[] }[];
  res.json(
    models.map((m) => ({
      id: m.id,
      name: m.name,
      contextLength: m.context_length,
      promptPrice: m.pricing?.prompt ? Number(m.pricing.prompt) * 1e6 : null,
      completionPrice: m.pricing?.completion ? Number(m.pricing.completion) * 1e6 : null,
      tools: m.supported_parameters?.includes("tools") ?? false,
    })),
  );
});
