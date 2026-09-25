import { normalizeText } from "./normalize.js";

const CONTACTS = [
  { id: "contact-ahmed-ali", name: "أحمد علي" },
  { id: "contact-ahmed-hassan", name: "أحمد حسن" },
  { id: "contact-layla", name: "ليلى" },
  { id: "contact-omar", name: "عمر" },
];

const BILLERS = [
  { id: "bill-electricity-home", name: "فاتورة الكهرباء", aliases: ["الكهرباء", "كهرباء"], accountLabel: "حساب الكهرباء المنزلي", reference: "••12", amountDue: 25_000 },
  { id: "bill-home-internet", name: "إنترنت البيت", aliases: ["انترنت البيت", "الانترنت", "النت"], accountLabel: "حساب الإنترنت المنزلي", reference: "••47", amountDue: 35_000 },
  { id: "bill-zain", name: "فاتورة زين", aliases: ["زين", "فاتورة زين"], accountLabel: "خط زين المفوتر", reference: "••83", amountDue: 15_000 },
];

function containsWordSequence(haystack, needle) {
  return haystack.includes(needle);
}

export class WalletSimulator {
  constructor({ balance = 250_000 } = {}) {
    this.balance = balance;
    this.contacts = CONTACTS.map((contact) => ({ ...contact, normalizedName: normalizeText(contact.name) }));
    this.billers = BILLERS.map((biller) => ({
      ...biller,
      normalizedName: normalizeText(biller.name),
      normalizedAliases: biller.aliases.map(normalizeText),
    }));
    this.ledger = [];
    this.idempotencyResults = new Map();
  }

  findRecipients(query) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return [];
    return this.contacts.filter((contact) =>
      contact.normalizedName === normalizedQuery ||
      contact.normalizedName.startsWith(`${normalizedQuery} `) ||
      contact.normalizedName.split(" ").includes(normalizedQuery) ||
      containsWordSequence(` ${contact.normalizedName} `, ` ${normalizedQuery} `),
    );
  }

  findBillers(query) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return [];
    return this.billers.filter((biller) =>
      biller.normalizedName.includes(normalizedQuery) ||
      biller.normalizedAliases.some((alias) => alias === normalizedQuery || alias.includes(normalizedQuery)),
    );
  }

  getBalance() {
    return this.balance;
  }

  getBill(billerId) {
    return this.billers.find((biller) => biller.id === billerId) ?? null;
  }

  validateAction(action) {
    if (!Number.isSafeInteger(action.amount) || action.amount <= 0) {
      return { ok: false, reason: "invalid_amount" };
    }
    if (action.type === "TRANSFER") {
      if (!this.contacts.some((contact) => contact.id === action.recipientId)) {
        return { ok: false, reason: "invalid_recipient" };
      }
    } else if (action.type === "BILL_PAYMENT") {
      const biller = this.getBill(action.billerId);
      if (!biller) return { ok: false, reason: "invalid_biller" };
      if (action.amount !== biller.amountDue) return { ok: false, reason: "bill_amount_mismatch", expected: biller.amountDue };
    } else {
      return { ok: false, reason: "unsupported_action" };
    }
    if (action.amount > this.balance) return { ok: false, reason: "insufficient_funds" };
    return { ok: true };
  }

  execute(action, idempotencyKey) {
    if (!idempotencyKey) return { ok: false, reason: "missing_idempotency_key" };
    if (this.idempotencyResults.has(idempotencyKey)) {
      return { ...this.idempotencyResults.get(idempotencyKey), duplicate: true };
    }

    const validation = this.validateAction(action);
    if (!validation.ok) return validation;

    this.balance -= action.amount;
    const result = {
      ok: true,
      transactionId: `demo-${String(this.ledger.length + 1).padStart(6, "0")}`,
      balanceAfter: this.balance,
    };
    this.ledger.push({ ...action, idempotencyKey, ...result, createdAt: new Date().toISOString() });
    this.idempotencyResults.set(idempotencyKey, result);
    return result;
  }
}
