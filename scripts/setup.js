import { openStore } from "../src/store.js";
import { seed } from "../src/server.js";
import { randomBytes } from "node:crypto";
const db = openStore(process.env.DATA_DIR || "data");
if (db.prepare("SELECT count(*) n FROM users").get().n) {
  console.log("Users already configured");
  db.close();
  process.exit(0);
}
const users = [
  {
    id: "institution-a",
    email: "institution@sentinel.local",
    role: "institution",
    tenant: "fictional-a",
  },
  {
    id: "institution-b",
    email: "other@sentinel.local",
    role: "institution",
    tenant: "fictional-b",
  },
  {
    id: "officer-a",
    email: "officer@sentinel.local",
    role: "officer",
    tenant: "authority",
  },
].map((u) => ({ ...u, password: randomBytes(18).toString("base64url") }));
seed(db, users);
for (const u of users) console.log(u.email + "  " + u.password);
db.close();
