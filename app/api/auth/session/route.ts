import { canvasAuthenticationDisabled, cloudPersistenceEnabled } from "@/app/server/config";
import { readSessionUser, responseFromError } from "@/app/server/auth";

export async function GET(request: Request) {
  if (!cloudPersistenceEnabled()) {
    return Response.json({ mode: "local", user: null, authenticationRequired: false });
  }
  try {
    return Response.json({
      mode: "server",
      user: await readSessionUser(request),
      authenticationRequired: !canvasAuthenticationDisabled(),
    });
  } catch (error) {
    return responseFromError(error, "无法读取登录状态。");
  }
}
