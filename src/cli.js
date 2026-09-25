import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { WalletAgent } from "./agent.js";
import { AuditLogger } from "./audit-logger.js";
import { WalletSimulator } from "./wallet-simulator.js";

const wallet = new WalletSimulator();
const agent = new WalletAgent({ wallet, audit: new AuditLogger() });
const readline = createInterface({ input, output, prompt: "إنت: " });

console.log("وكيل المحفظة التجريبي — العمليات محاكاة محلية فقط. اكتب «خروج» لإنهاء الجلسة.");
readline.prompt();

for await (const line of readline) {
  const message = line.trim();
  if (["خروج", "exit", "quit"].includes(message.toLowerCase())) break;
  console.log(`الوكيل: ${agent.handle(message)}`);
  readline.prompt();
}

readline.close();
console.log("انتهت الجلسة التجريبية.");
