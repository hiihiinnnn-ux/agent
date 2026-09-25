import { extractAmountCandidates, isNumberWord, normalizeText } from "./normalize.js";

const TRANSFER_PATTERN = /(?:دز|دزه|دزلي|حول|حوللي|حوالة|تحويل|ابعث|ابعت|ارسل|رسل)/u;
const BILL_PATTERN = /(?:ادفع|دفع|سدد|فاتورة|فواتير)/u;
const BALANCE_PATTERN = /(?:رصيدي|رصيد\s+المحفظة|رصيد\s+الحساب|شكد\s+رصيدي|كم\s+رصيدي)/u;
const POLITE_TAIL = new Set(["لو", "سمحت", "هسه", "الان", "اليوم", "رجاء", "رجاءا", "من", "فضلك"]);

function extractRecipientQuery(normalized) {
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  let nameTokens = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "الى") {
      nameTokens = tokens.slice(index + 1);
      break;
    }
    if (token === "ل") {
      nameTokens = tokens.slice(index + 1);
      break;
    }
    if (token.startsWith("لل") && token.length > 3) {
      nameTokens = [token.slice(2), ...tokens.slice(index + 1)];
      break;
    }
    if (token.startsWith("ل") && token.length > 2 && !/^ل(?:يش|ما|و)$/u.test(token)) {
      nameTokens = [token.slice(1), ...tokens.slice(index + 1)];
      break;
    }
  }

  if (!nameTokens) return null;
  const retained = [];
  for (const token of nameTokens) {
    if (POLITE_TAIL.has(token)) break;
    if (/^\d+$/u.test(token) || isNumberWord(token)) continue;
    if (token === "و" || token === "دينار" || token === "دنانير" || token === "عراقي" || token === "عراقيه") continue;
    retained.push(token);
  }
  while (retained.length > 0 && /^(?:دينار|دنانير|عراقي|عراقيه|عراقية)$/u.test(retained.at(-1))) {
    retained.pop();
  }
  return retained.join(" ").trim() || null;
}

function extractBillQuery(normalized) {
  const markers = ["فاتورة", "فواتير", "ادفع", "سدد"];
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const index = tokens.findIndex((token) => markers.includes(token));
  if (index < 0) return null;
  const query = tokens.slice(index + 1).filter((token) => !/^\d+$/u.test(token));
  return query.join(" ").trim() || null;
}

export function parseIntent(message) {
  const normalized = normalizeText(message);
  if (!normalized) return { type: "UNKNOWN", reason: "empty" };

  if (BALANCE_PATTERN.test(normalized)) return { type: "BALANCE_CHECK" };

  const isBill = BILL_PATTERN.test(normalized);
  if (isBill) {
    const amounts = extractAmountCandidates(normalized);
    return {
      type: "BILL_PAYMENT",
      amount: amounts.length === 1 ? amounts[0] : null,
      amountAmbiguous: amounts.length > 1,
      billQuery: extractBillQuery(normalized),
    };
  }

  if (TRANSFER_PATTERN.test(normalized)) {
    const amounts = extractAmountCandidates(normalized);
    return {
      type: "TRANSFER",
      amount: amounts.length === 1 ? amounts[0] : null,
      amountAmbiguous: amounts.length > 1,
      recipientQuery: extractRecipientQuery(normalized),
    };
  }

  return { type: "UNKNOWN" };
}
