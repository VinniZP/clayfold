import { Hono } from "hono";
import { search } from "../search";

export const searchRoutes = new Hono();

const QUERY_MAX = 200;

searchRoutes.get("/search", (c) => c.json(search((c.req.query("q") ?? "").slice(0, QUERY_MAX))));
