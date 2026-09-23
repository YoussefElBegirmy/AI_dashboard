import { Router } from "express";

/**
 * Sample endpoints for trying the dashboard without your own API.
 * Disable with ENABLE_DEV_MOCKS=false.
 */
export const devRouter = Router();

devRouter.post("/mock/echo", (req, res) => {
  const message = String(req.body?.message ?? req.body?.input ?? "");
  res.json({ reply: `Echo: ${message}`, length: message.length, receivedAt: new Date().toISOString() });
});

/** Answers a few capital-city questions; wrong on purpose for some to make evals interesting. */
devRouter.post("/mock/qa", (req, res) => {
  const q = String(req.body?.question ?? req.body?.message ?? "").toLowerCase();
  const answers: [RegExp, string][] = [
    [/france/, "The capital of France is Paris."],
    [/japan/, "The capital of Japan is Tokyo."],
    [/australia/, "The capital of Australia is Sydney."],
    [/canada/, "Canada's capital is Ottawa."],
  ];
  const hit = answers.find(([re]) => re.test(q));
  setTimeout(() => res.json({ answer: hit ? hit[1] : "I don't know.", confidence: hit ? 0.9 : 0.1 }), 50 + Math.random() * 400);
});

devRouter.post("/mock/flaky", (_req, res) => {
  if (Math.random() < 0.3) return res.status(503).json({ error: "Service temporarily unavailable" });
  res.json({ ok: true, reply: "Success" });
});
