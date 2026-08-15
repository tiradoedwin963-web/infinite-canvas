export function cloudPersistenceEnabled() {
  return process.env.WORKFLOW_STORAGE_MODE === "server";
}
export function requireEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少服务端环境变量 ${name}。`);
  return value;
}
