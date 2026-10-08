import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { checkBaasHealth } from "../lib/baas";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  try {
    await checkBaasHealth();
    return res.json(HealthCheckResponse.parse({ status: "ok" }));
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : "unknown" }, "BaaS readiness check failed");
    return res.status(503).json(HealthCheckResponse.parse({ status: "degraded" }));
  }
});

export default router;
