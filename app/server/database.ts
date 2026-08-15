import postgres from "postgres";
import { cloudPersistenceEnabled, requireEnvironment } from "./config.ts";

let database: ReturnType<typeof postgres> | undefined;

export function getDatabase() {
  if (!cloudPersistenceEnabled()) {
    throw new Error("当前环境未启用云端工作流存储。");
  }
  database ??= postgres(requireEnvironment("DATABASE_URL"), {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    transform: { undefined: null },
  });
  return database;
}

export type AuthenticatedUser = {
  id: string;
  username: string;
  isAdmin: boolean;
};
