import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import { promisify } from "node:util";

const password = process.argv[2];
if (!password || password.length < 12) {
  throw new Error("Provide a password with at least 12 characters");
}
const salt = randomBytes(16);
const key = await promisify(nodeScrypt)(password, salt, 64);
process.stdout.write(`scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`);
