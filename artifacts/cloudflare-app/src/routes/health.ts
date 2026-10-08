import { Hono } from "hono";
import { HealthCheckResponse } from "@workspace/api-zod";
import { checkBaasHealth } from "../lib/baas";
import type { Bindings, Variables } from "../env.d";

const health = new Hono<{ Bindings: Bindings; Variables: Variables }>();

health.get("/healthz", async (c) => {
  try {
    await checkBaasHealth(c.env);
    return c.json(HealthCheckResponse.parse({ status: "ok" }));
  } catch {
    return c.json(HealthCheckResponse.parse({ status: "degraded" }), 503);
  }
});

export default health;
