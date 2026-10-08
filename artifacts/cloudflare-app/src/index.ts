import { Hono } from "hono";
import health from "./routes/health";
import files from "./routes/files";
import profiles from "./routes/profiles";
import settings from "./routes/settings";
import type { Bindings, Variables } from "./env.d";
import { BaasError } from "./lib/baas";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// The Worker serves the frontend and API on the same origin. Reject browser
// mutations initiated by other sites, while allowing non-browser clients that
// do not send Origin or Fetch Metadata headers.
app.use("/api/*", async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    await next();
    return;
  }

  const origin = c.req.header("origin");
  const fetchSite = c.req.header("sec-fetch-site");
  let trusted = !origin && fetchSite !== "cross-site";
  if (origin) {
    try {
      const parsed = new URL(origin);
      trusted =
        parsed.origin === origin &&
        parsed.origin === new URL(c.req.url).origin &&
        (parsed.protocol === "https:" || parsed.protocol === "http:");
    } catch {
      trusted = false;
    }
  }

  if (!trusted) {
    return c.json({ error: "Untrusted request origin" }, 403);
  }
  await next();
});

// ── Global error handler ──────────────────────────────────────────────────────
app.onError((err, c) => {
  if (err instanceof BaasError) {
    console.error("[app] BaaS request failed", { status: err.status });
    return c.json({ error: "Upstream service request failed" }, 502);
  }
  console.error("[app] Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

app.route("/api", health);
app.route("/api", files);
app.route("/api", profiles);
app.route("/api", settings);

// Serve the built minecraft-hub SPA for all other routes.
// not_found_handling = "single-page-application" in wrangler.toml handles
// client-side routes by returning index.html.
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
