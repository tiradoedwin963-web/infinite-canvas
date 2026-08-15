import { cloudPersistenceEnabled } from "@/app/server/config";

export async function GET() {
  return Response.json({ mode: cloudPersistenceEnabled() ? "server" : "local" });
}
