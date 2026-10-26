import { openStore } from "../src/store.js";
import { seed } from "../src/server.js";
import { randomBytes } from "node:crypto";
const db = openStore(process.env.DATA_DIR || "data");
const users = [
  {
    id: "institution-admin",
    email: "admin@sentinel.local",
    role: "institution_admin",
    tenant: "fictional-a",
  },
  {
    id: "supervisor",
    email: "supervisor@sentinel.local",
    role: "supervisor",
    tenant: "authority",
  },
  {
    id: "audit-reviewer",
    email: "audit@sentinel.local",
    role: "audit_reviewer",
    tenant: "authority",
  },
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
]
  .filter((u) => !db.prepare("SELECT id FROM users WHERE email=?").get(u.email))
  .map((u) => ({ ...u, password: randomBytes(18).toString("base64url") }));
seed(db, users);
for (const u of users) console.log(u.email + "  " + u.password);
db.close();
