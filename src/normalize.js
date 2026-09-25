const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640]/gu, "")
    .replace(/[أإآٱ]/gu, "ا")
    .replace(/ى/gu, "ي")
    .replace(/[٠-٩]/gu, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/gu, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[،؛؟!()[\]{}:؛]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("ar");
}

const NUMBER_WORDS = new Map([
  ["صفر", 0], ["واحد", 1], ["وحدة", 1], ["واحدة", 1], ["احد", 1], ["احدى", 1],
  ["اثنين", 2], ["اثنان", 2], ["ثنين", 2], ["اثنتين", 2], ["ثنتين", 2],
  ["ثلاث", 3], ["ثلاثة", 3], ["ثلاثه", 3], ["اربعة", 4], ["اربعه", 4], ["اربع", 4],
  ["خمسة", 5], ["خمسه", 5], ["خمس", 5], ["ستة", 6], ["سته", 6], ["ست", 6],
  ["سبعة", 7], ["سبعه", 7], ["سبع", 7], ["ثمانية", 8], ["ثمانيه", 8], ["ثمان", 8],
  ["تسعة", 9], ["تسعه", 9], ["تسع", 9], ["عشرة", 10], ["عشره", 10], ["عشر", 10],
  ["احدعش", 11], ["احدعشر", 11], ["اثنعش", 12], ["اثناعش", 12], ["ثلاثتعش", 13],
  ["اربعتعش", 14], ["خمستعش", 15], ["ستعش", 16], ["سبعتعش", 17], ["ثمنتعش", 18], ["تسعتعش", 19],
  ["عشرين", 20], ["عشرون", 20], ["ثلاثين", 30], ["ثلاثون", 30],
  ["اربعين", 40], ["اربعون", 40], ["خمسين", 50], ["خمسون", 50],
  ["ستين", 60], ["ستون", 60], ["سبعين", 70], ["سبعون", 70],
  ["ثمانين", 80], ["ثمانون", 80], ["تسعين", 90], ["تسعون", 90],
  ["مية", 100], ["مئة", 100], ["مائه", 100], ["مائة", 100],
  ["الف", 1_000], ["الاف", 1_000], ["مليون", 1_000_000], ["ملايين", 1_000_000],
]);

function wordValue(token) {
  if (NUMBER_WORDS.has(token)) return NUMBER_WORDS.get(token);
  if (token.startsWith("و") && NUMBER_WORDS.has(token.slice(1))) return NUMBER_WORDS.get(token.slice(1));
  return null;
}

function parseNumberWords(tokens) {
  let group = 0;
  let total = 0;
  let count = 0;
  for (const rawToken of tokens) {
    if (rawToken === "و") continue;
    const token = wordValue(rawToken);
    if (token === null || token === undefined) return null;
    count += 1;
    if (token === 100) {
      group = (group || 1) * 100;
    } else if (token === 1_000 || token === 1_000_000) {
      total += (group || 1) * token;
      group = 0;
    } else {
      group += token;
    }
  }
  const value = total + group;
  return count > 0 && Number.isSafeInteger(value) ? value : null;
}

export function isNumberWord(token) {
  return wordValue(token) !== null;
}

export function hasUnsupportedCurrency(value) {
  const normalized = normalizeText(value);
  return /(?:دولار|دولارات|دولار امريكي|usd|\$)/u.test(normalized);
}

export function hasNegativeAmount(value) {
  return /(?:-|−)\s*\d/u.test(normalizeText(value));
}

export function extractAmountCandidates(value) {
  const normalized = normalizeText(value);
  const candidates = new Set();
  const digitMatches = normalized.matchAll(/(?<![\p{L}\p{N}])(?:\d{1,3}(?:,\d{3})+|\d+)(?![\p{L}\p{N}])/gu);

  for (const match of digitMatches) {
    const digits = match[0].replace(/[\s,]/gu, "");
    if (digits) {
      const amount = Number(digits);
      if (Number.isSafeInteger(amount)) candidates.add(amount);
    }
  }

  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  for (let start = 0; start < tokens.length; start += 1) {
    if (wordValue(tokens[start]) === null) continue;
    if (start > 0 && (wordValue(tokens[start - 1]) !== null || tokens[start - 1] === "و")) continue;
    const sequence = [];
    let end = start;
    while (end < tokens.length) {
      const token = tokens[end];
      if (token === "و" && sequence.length > 0 && wordValue(tokens[end + 1] ?? "") !== null) {
        sequence.push(token);
        end += 1;
        continue;
      }
      if (wordValue(token) === null) break;
      sequence.push(token);
      end += 1;
    }
    const parsed = parseNumberWords(sequence);
    if (parsed !== null) candidates.add(parsed);
  }

  return [...candidates].filter((amount) => amount > 0).sort((a, b) => a - b);
}

export function formatIqd(amount) {
  return `${new Intl.NumberFormat("en-US").format(amount)} د.ع`;
}
