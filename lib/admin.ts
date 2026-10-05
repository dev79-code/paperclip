import { config } from "./config";
export function isAdmin(req: Request) {
  const k = req.headers.get("x-admin-key") || new URL(req.url).searchParams.get("key");
  return !!k && k === config.adminPassword;
}
export const deny = () => Response.json({ error: "unauthorized" }, { status: 401 });
