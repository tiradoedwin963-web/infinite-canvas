import type { AgentResponse } from "./agent.ts";

export type AgentSseEvent = {
  event: string;
  data: string;
};

export function encodeAgentSseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function splitSseEvents(buffer: string): {
  events: AgentSseEvent[];
  remainder: string;
} {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const events = blocks.flatMap((block) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    return data.length ? [{ event, data: data.join("\n") }] : [];
  });
  return { events, remainder };
}

function findJsonStringStart(raw: string, key: string) {
  const keyIndex = raw.indexOf(`"${key}"`);
  if (keyIndex < 0) return -1;
  const colonIndex = raw.indexOf(":", keyIndex + key.length + 2);
  if (colonIndex < 0) return -1;
  let index = colonIndex + 1;
  while (/\s/.test(raw[index] ?? "")) index += 1;
  return raw[index] === '"' ? index + 1 : -1;
}

export function extractProgressSummary(raw: string) {
  const start = ["progress_summary", "progressSummary"]
    .map((key) => findJsonStringStart(raw, key))
    .find((index) => index >= 0);
  if (start === undefined) return "";

  let result = "";
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === '"') return result.trim();
    if (character !== "\\") {
      result += character;
      continue;
    }
    const escaped = raw[index + 1];
    if (escaped === undefined) return result.trim();
    const simpleEscapes: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (escaped in simpleEscapes) {
      result += simpleEscapes[escaped];
      index += 1;
      continue;
    }
    if (escaped === "u") {
      const code = raw.slice(index + 2, index + 6);
      if (!/^[0-9a-f]{4}$/i.test(code)) return result.trim();
      result += String.fromCharCode(Number.parseInt(code, 16));
      index += 5;
      continue;
    }
    return result.trim();
  }
  return result.trim();
}

export async function readAgentSseResponse(
  response: Response,
  onProgress: (text: string) => void,
  onActivity: () => void = () => {},
): Promise<AgentResponse> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/event-stream")) {
    const result = (await response.json()) as AgentResponse;
    onActivity();
    return result;
  }
  if (!response.body) throw new Error("画布 Agent 流式响应已中断。");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: AgentResponse | null = null;

  const consume = (events: AgentSseEvent[]) => {
    for (const item of events) {
      onActivity();
      let payload: unknown;
      try {
        payload = JSON.parse(item.data);
      } catch {
        throw new Error("画布 Agent 返回了无法识别的流式事件。");
      }
      if (item.event === "activity") {
        continue;
      } else if (item.event === "progress") {
        const text =
          payload && typeof payload === "object" && "text" in payload
            ? Reflect.get(payload, "text")
            : "";
        if (typeof text === "string") onProgress(text);
      } else if (item.event === "result") {
        result = payload as AgentResponse;
      } else if (item.event === "error") {
        const message =
          payload && typeof payload === "object" && "message" in payload
            ? Reflect.get(payload, "message")
            : "";
        throw new Error(
          typeof message === "string" && message
            ? message
            : "画布 Agent 请求失败，请稍后重试。",
        );
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const parsed = splitSseEvents(buffer);
    buffer = parsed.remainder;
    consume(parsed.events);
    if (done) break;
  }
  if (buffer.trim()) {
    const parsed = splitSseEvents(`${buffer}\n\n`);
    consume(parsed.events);
  }
  if (!result) throw new Error("画布 Agent 流式响应已中断。");
  return result;
}
