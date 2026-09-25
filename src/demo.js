import { WalletAgent } from "./agent.js";
import { AuditLogger } from "./audit-logger.js";
import { WalletSimulator } from "./wallet-simulator.js";

const agent = new WalletAgent({ wallet: new WalletSimulator(), audit: new AuditLogger(), sessionId: "hackathon-demo" });
const conversation = [
  "دز خمسين لأحمد",
  "أحمد حسن",
  "اي",
];

for (const userMessage of conversation) {
  console.log(`إنت: ${userMessage}`);
  console.log(`الوكيل: ${agent.handle(userMessage)}`);
}
