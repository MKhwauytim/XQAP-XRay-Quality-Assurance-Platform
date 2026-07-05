// Vite dev-server middleware exposing the deck-preview style-switcher's
// persistence endpoint. Dev-only: only registered by vite.config.ts's plugin
// list, never runs in `npm run build` output.
import type { Plugin } from "vite";
import { readChoices, writeChoice } from "./deckStyleChoices";

const ENDPOINT = "/__deck-style-choices";
const CHOICES_PATH = "dev-workspace/6-templates/deck-style-choices.json";

export function deckStyleChoicesPlugin(): Plugin {
  return {
    name: "deck-style-choices",
    configureServer(server) {
      server.middlewares.use(ENDPOINT, (req, res) => {
        if (req.method === "GET") {
          const envelope = readChoices(CHOICES_PATH);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(envelope.data));
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on("end", () => {
            try {
              const parsed = JSON.parse(body) as { slideId?: unknown; variantIndex?: unknown };
              if (typeof parsed.slideId !== "string" || typeof parsed.variantIndex !== "number") {
                res.statusCode = 400;
                res.end("bad request");
                return;
              }
              writeChoice(CHOICES_PATH, parsed.slideId, parsed.variantIndex);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end("bad request");
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end("method not allowed");
      });
    },
  };
}
