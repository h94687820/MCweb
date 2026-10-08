import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { BaasError } from "./lib/baas";

const app: Express = express();
const allowedCorsOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      const parsed = new URL(origin);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("CORS_ALLOWED_ORIGINS must contain HTTP(S) origins");
      }
      return parsed.origin;
    }),
);

function isTrustedBrowserOrigin(origin: string, host: string | undefined) {
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !["https:", "http:"].includes(parsed.protocol)) {
      return false;
    }
    return parsed.host.toLowerCase() === host?.toLowerCase() || allowedCorsOrigins.has(parsed.origin);
  } catch {
    return false;
  }
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (origin && allowedCorsOrigins.has(origin)) {
        callback(null, origin);
        return;
      }
      callback(null, false);
    },
  }),
);
app.use("/api", (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }

  const origin = req.get("origin");
  const fetchSite = req.get("sec-fetch-site");
  const trusted = origin
    ? isTrustedBrowserOrigin(origin, req.get("host"))
    : fetchSite !== "cross-site";

  if (!trusted) {
    res.status(403).json({ error: "Untrusted request origin" });
    return;
  }
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// All file storage is now handled by BaaS — no local uploads directory needed.

app.use("/api", router);

// Keep implementation and upstream error details in server logs only.
app.use((err: any, _req: any, res: any, _next: any) => {
  const requestedStatus = Number(err?.status ?? err?.statusCode);
  const isValidStatus = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599;
  const status = err instanceof BaasError ? 502 : isValidStatus ? requestedStatus : 500;
  const isSafeClientError = status < 500 && !(err instanceof BaasError);
  const message = isSafeClientError ? err?.message ?? "Request failed" : "Internal server error";

  logger.error({ err: err?.message, stack: err?.stack }, "Unhandled error");
  res.status(status).json({ error: message });
});

export default app;
