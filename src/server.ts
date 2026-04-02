import Fastify from "fastify";
import staticPlugin from "@fastify/static";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getRoutes } from "./flights.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

app.register(staticPlugin, {
  root: join(__dirname, "../public"),
  prefix: "/",
});

const upSince = new Date().toISOString();
let apiRequests = 0;
let lastRequestAt: string | null = null;

app.get("/health", async () => ({ status: "ok" }));

app.get("/api/routes", async (req, reply) => {
  apiRequests++;
  lastRequestAt = new Date().toISOString();
  try {
    const { from, to, direction } = req.query as { from?: string; to?: string; direction?: string };
    const dir: "departure" | "arrival" = direction === "arrival" ? "arrival" : "departure";
    const routes = await getRoutes(from, to, dir);
    return reply.send(routes);
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({ error: "Failed to fetch routes" });
  }
});

app.get("/stats", async (req, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  return {
    service: "otselennud",
    upSince,
    apiRequests,
    lastRequestAt,
  };
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

app.listen({ port, host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  // Pre-warm the cache so the first real request is instant
  getRoutes().catch((e) => app.log.warn("Cache pre-warm (dep) failed: " + e.message));
  getRoutes(undefined, undefined, "arrival").catch((e) => app.log.warn("Cache pre-warm (arr) failed: " + e.message));
});
