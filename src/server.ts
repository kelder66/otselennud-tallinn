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

class TimedCounter {
  private times: number[] = [];
  private allTime = 0;

  record(): void {
    const now = Date.now();
    this.times.push(now);
    this.allTime++;
    const cutoff = now - 7 * 24 * 60 * 60 * 1000;
    if (this.times.length > 0 && this.times[0] < cutoff) {
      this.times = this.times.filter(t => t >= cutoff);
    }
  }

  snapshot() {
    const now = Date.now();
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const weekStart = now - 7 * 24 * 60 * 60 * 1000;
    return {
      today:    this.times.filter(t => t >= todayStart).length,
      lastWeek: this.times.filter(t => t >= weekStart).length,
      total:    this.allTime,
    };
  }
}

const upSince = new Date().toISOString();
const requests = new TimedCounter();
let lastRequestAt: string | null = null;

app.get("/health", async () => ({ status: "ok" }));

app.get("/api/routes", async (req, reply) => {
  requests.record();
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
    requests: requests.snapshot(),
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
