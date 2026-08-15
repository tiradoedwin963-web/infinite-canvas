"use client";

import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";

export type CloudUser = { id: string; username: string; isAdmin: boolean };

const CloudSessionContext = createContext<{
  remote: boolean;
  user: CloudUser | null;
}>({ remote: false, user: null });

export function useCloudSession() {
  return useContext(CloudSessionContext);
}

async function safeError(response: Response) {
  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === "string") return payload.error;
  } catch {
    // Use the local fallback.
  }
  return "请求失败，请稍后重试。";
}

export function CloudSessionGate({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<"loading" | "local" | "server">("loading");
  const [user, setUser] = useState<CloudUser | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await safeError(response));
        return response.json() as Promise<{ mode: "local" | "server"; user: CloudUser | null }>;
      })
      .then((session) => {
        if (!active) return;
        setMode(session.mode);
        setUser(session.user);
      })
      .catch(() => {
        if (active) setMode("server");
      });
    return () => { active = false; };
  }, []);

  if (mode === "loading") return <div className="cloud-session-loading">正在连接画布…</div>;
  if (mode === "server" && !user) return <CloudLogin onAuthenticated={setUser} />;
  return (
    <CloudSessionContext.Provider value={{ remote: mode === "server", user }}>
      {children}
      {mode === "server" && user ? (
        <CloudAccount user={user} onLoggedOut={() => setUser(null)} />
      ) : null}
    </CloudSessionContext.Provider>
  );
}

function CloudLogin({ onAuthenticated }: { onAuthenticated: (user: CloudUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) throw new Error(await safeError(response));
      const payload = await response.json() as { user: CloudUser };
      onAuthenticated(payload.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="cloud-login-shell">
      <form className="cloud-login-card" onSubmit={submit}>
        <span>LingkeAI Canvas</span>
        <h1>登录画布</h1>
        <p>项目与素材将按账号隔离并同步到云端。</p>
        <label>用户名<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label>密码<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error ? <p className="cloud-login-error">{error}</p> : null}
        <button disabled={busy || !username || !password} type="submit">{busy ? "正在登录…" : "登录"}</button>
      </form>
    </main>
  );
}

function CloudAccount({ user, onLoggedOut }: { user: CloudUser; onLoggedOut: () => void }) {
  const [adminOpen, setAdminOpen] = useState(false);
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    onLoggedOut();
  }
  return (
    <div className="cloud-account" data-workflow-isolated>
      <span>{user.username}</span>
      {user.isAdmin ? <button type="button" onClick={() => setAdminOpen(true)}>账号管理</button> : null}
      <button type="button" onClick={() => void logout()}>退出</button>
      {adminOpen ? <AdminUsers onClose={() => setAdminOpen(false)} /> : null}
    </div>
  );
}

type AdminUser = {
  id: string;
  username: string;
  is_admin: boolean;
  disabled_at: string | null;
};

function AdminUsers({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [username, setUsername] = useState("");
  const [oneTimePassword, setOneTimePassword] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    if (!response.ok) throw new Error(await safeError(response));
    const payload = await response.json() as { users: AdminUser[] };
    setUsers(payload.users);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught) => setError(String(caught)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    if (!response.ok) return setError(await safeError(response));
    const payload = await response.json() as { temporaryPassword: string };
    setOneTimePassword(payload.temporaryPassword);
    setUsername("");
    await load();
  }

  async function change(userId: string, action: "reset-password" | "set-disabled", disabled?: boolean) {
    setError("");
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action, disabled }),
    });
    if (!response.ok) return setError(await safeError(response));
    const payload = await response.json() as { temporaryPassword?: string };
    setOneTimePassword(payload.temporaryPassword ?? "");
    await load();
  }

  return (
    <div className="cloud-admin-backdrop" role="dialog" aria-modal="true" aria-label="账号管理">
      <section className="cloud-admin-card">
        <header><h2>账号管理</h2><button type="button" onClick={onClose}>关闭</button></header>
        <form onSubmit={create}><input placeholder="新用户名" value={username} onChange={(event) => setUsername(event.target.value)} /><button type="submit">创建账号</button></form>
        {oneTimePassword ? <p className="cloud-one-time-password">一次性临时密码：<code>{oneTimePassword}</code><br />请立即安全保存，关闭后不再显示。</p> : null}
        {error ? <p className="cloud-login-error">{error}</p> : null}
        <div className="cloud-user-list">{users.map((item) => (
          <div key={item.id}>
            <span>{item.username}{item.is_admin ? " · 管理员" : ""}{item.disabled_at ? " · 已停用" : ""}</span>
            <button type="button" onClick={() => void change(item.id, "reset-password")}>重置密码</button>
            <button type="button" onClick={() => void change(item.id, "set-disabled", !item.disabled_at)}>{item.disabled_at ? "启用" : "停用"}</button>
          </div>
        ))}</div>
      </section>
    </div>
  );
}
