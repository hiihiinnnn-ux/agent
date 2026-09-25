import { randomUUID } from "node:crypto";
import { formatIqd, extractAmountCandidates, hasNegativeAmount, hasUnsupportedCurrency, normalizeText } from "./normalize.js";
import { parseIntent } from "./intent-parser.js";
import { AuditLogger } from "./audit-logger.js";

const CONFIRMATIONS = new Set(["اي", "اي نعم", "نعم", "اكد", "تاكيد", "اوافق", "موافق", "yes", "confirm"]);
const CANCELLATIONS = new Set(["لا", "الغاء", "الغي", "ما اريد", "الغاء العملية", "no", "cancel"]);
const ORDINALS = new Map([["1", 0], ["الاول", 0], ["الاولى", 0], ["اول واحد", 0], ["2", 1], ["الثاني", 1], ["الثانية", 1], ["ثاني واحد", 1], ["3", 2], ["الثالث", 2], ["الثالثة", 2]]);

function auditBase(sessionId, type) {
  return { sessionId, event: type };
}

function safeTarget(action) {
  return action.type === "TRANSFER"
    ? { recipientId: action.recipientId, recipientName: action.recipientName }
    : { billerId: action.billerId, billerName: action.billerName, accountReference: action.accountReference };
}

export class WalletAgent {
  constructor({ wallet, audit = new AuditLogger(), sessionId = randomUUID() }) {
    this.wallet = wallet;
    this.audit = audit;
    this.sessionId = sessionId;
    this.draft = null;
    this.awaiting = null;
    this.pendingAction = null;
  }

  handle(message) {
    const text = String(message ?? "").trim();
    if (!text) return "ما وصلني طلب. شتريد تسوي؟";
    this.audit.record({ ...auditBase(this.sessionId, "request_received"), characterCount: text.length });

    if (this.pendingAction) return this.#handlePendingConfirmation(text);
    if (CANCELLATIONS.has(normalizeText(text))) {
      if (this.draft) this.audit.record({ ...auditBase(this.sessionId, "draft_cancelled"), actionType: this.draft.type });
      this.#clearDraft();
      return "ألغيت الطلب. ما تمت أي عملية.";
    }
    if (this.awaiting === "recipient_choice") return this.#handleRecipientChoice(text);
    if (this.draft) return this.#continueDraft(text);

    if (hasUnsupportedCurrency(text)) {
      this.audit.record({ ...auditBase(this.sessionId, "unsupported_currency_requested") });
      return "النموذج التجريبي يدعم الدينار العراقي فقط. ما نفذت أي عملية.";
    }
    if (hasNegativeAmount(text)) {
      this.audit.record({ ...auditBase(this.sessionId, "invalid_amount_rejected") });
      return "المبلغ لازم يكون أكبر من صفر. ما نفذت أي عملية.";
    }

    const intent = parseIntent(text);
    if (intent.type === "BALANCE_CHECK") {
      const balance = this.wallet.getBalance();
      this.audit.record({ ...auditBase(this.sessionId, "balance_checked"), balance });
      return `رصيد المحفظة التجريبية: ${formatIqd(balance)}.`;
    }
    if (intent.type !== "TRANSFER" && intent.type !== "BILL_PAYMENT") {
      return "أكدر أساعدك بتحويل، دفع فاتورة، أو معرفة الرصيد. شتريد تسوي؟";
    }

    this.draft = intent.type === "TRANSFER"
      ? { type: intent.type, amount: intent.amount, amountAmbiguous: intent.amountAmbiguous, recipientQuery: intent.recipientQuery }
      : { type: intent.type, amount: intent.amount, amountAmbiguous: intent.amountAmbiguous, billQuery: intent.billQuery };
    return this.#resolveDraft();
  }

  #continueDraft(message) {
    if (hasUnsupportedCurrency(message)) {
      this.audit.record({ ...auditBase(this.sessionId, "unsupported_currency_requested"), actionType: this.draft.type });
      this.#clearDraft();
      return "النموذج التجريبي يدعم الدينار العراقي فقط. ألغيت الطلب وما نفذت أي عملية.";
    }
    if (hasNegativeAmount(message)) {
      this.audit.record({ ...auditBase(this.sessionId, "invalid_amount_rejected"), actionType: this.draft.type });
      this.#clearDraft();
      return "المبلغ لازم يكون أكبر من صفر. ألغيت الطلب وما نفذت أي عملية.";
    }
    const amountCandidates = extractAmountCandidates(message);
    if (this.draft.amountAmbiguous) {
      if (amountCandidates.length !== 1) return "المبلغ بعده مو واضح. اكتب مبلغ واحد بالدينار العراقي.";
      this.draft.amount = amountCandidates[0];
      this.draft.amountAmbiguous = false;
    } else if (this.draft.amount === null && amountCandidates.length === 1) {
      this.draft.amount = amountCandidates[0];
    }

    if (this.draft.type === "TRANSFER" && !this.draft.recipientId) {
      const query = this.#recipientFromReply(message);
      if (query) this.draft.recipientQuery = query;
    }
    if (this.draft.type === "BILL_PAYMENT" && !this.draft.billerId) {
      const query = normalizeText(message);
      if (query) this.draft.billQuery = query;
    }
    return this.#resolveDraft();
  }

  #recipientFromReply(message) {
    const normalized = normalizeText(message);
    const ordinal = ORDINALS.get(normalized);
    if (ordinal !== undefined && this.draft.recipientOptions?.[ordinal]) {
      const contact = this.draft.recipientOptions[ordinal];
      this.draft.recipientId = contact.id;
      this.draft.recipientName = contact.name;
      return null;
    }
    return normalized;
  }

  #resolveDraft() {
    const draft = this.draft;
    if (!draft) return "ماكو طلب معلّق.";
    if (draft.amountAmbiguous) return this.#ask("amount", "ما واضح عندي أي مبلغ تقصد. اكتب مبلغ واحد بالدينار العراقي.");
    if (draft.amount === null && draft.type === "TRANSFER") {
      return this.#ask("amount", "شكد المبلغ؟ اكتب المبلغ بالدينار العراقي.");
    }

    if (draft.type === "TRANSFER" && !draft.recipientId) {
      if (!draft.recipientQuery) return this.#ask("recipient", "لمن تريد تحوّل؟ اكتب اسم المستلم.");
      const matches = this.wallet.findRecipients(draft.recipientQuery);
      if (matches.length === 0) {
        draft.recipientOptions = null;
        return this.#ask("recipient", `ما لكيت مستلم بهالاسم عندك. تأكد من الاسم واكتبه بشكل أوضح.`);
      }
      if (matches.length > 1) {
        draft.recipientOptions = matches;
        this.awaiting = "recipient_choice";
        this.#auditClarification("recipient", draft.amount, { matchCount: matches.length });
        const options = matches.map((contact, index) => `${index + 1}. ${contact.name}`).join("، ");
        return `عندي أكثر من مستلم باسم ${draft.recipientQuery}: ${options}. منو تقصد؟ اكتب الاسم الكامل أو رقم الخيار.`;
      }
      draft.recipientId = matches[0].id;
      draft.recipientName = matches[0].name;
    }

    if (draft.type === "BILL_PAYMENT" && !draft.billerId) {
      if (!draft.billQuery) return this.#ask("biller", "أي فاتورة تريد تدفع؟ اكتب اسم الخدمة، مثل الكهرباء أو إنترنت البيت.");
      const matches = this.wallet.findBillers(draft.billQuery);
      if (matches.length === 0) return this.#ask("biller", "ما لكيت هالخدمة ضمن فواتير المحفظة التجريبية. اكتب اسم الخدمة بوضوح.");
      if (matches.length > 1) {
        this.#auditClarification("biller", null, { matchCount: matches.length });
        return this.#ask("biller", `لكيت أكثر من خدمة تطابق طلبك: ${matches.map((item) => item.name).join("، ")}. أي وحدة تقصد؟`);
      }
      const biller = matches[0];
      draft.billerId = biller.id;
      draft.billerName = biller.name;
      draft.accountLabel = biller.accountLabel;
      draft.accountReference = biller.reference;
      draft.invoiceAmount = biller.amountDue;
      if (draft.amount === null) draft.amount = biller.amountDue;
      if (draft.amount !== biller.amountDue) {
        this.audit.record({ ...auditBase(this.sessionId, "bill_amount_mismatch"), billerId: biller.id, requestedAmount: draft.amount, amountDue: biller.amountDue });
        this.#clearDraft();
        return `المبلغ المستحق على ${biller.name} هو ${formatIqd(biller.amountDue)}، والمبلغ اللي كتبته مختلف. ما دفعت شي. إذا تريد دفع المستحق، اكتب الطلب بالمبلغ الصحيح.`;
      }
    }

    const action = draft.type === "TRANSFER"
      ? { type: draft.type, amount: draft.amount, currency: "IQD", recipientId: draft.recipientId, recipientName: draft.recipientName }
      : { type: draft.type, amount: draft.amount, currency: "IQD", billerId: draft.billerId, billerName: draft.billerName, accountReference: draft.accountReference };

    const validation = this.wallet.validateAction(action);
    if (!validation.ok) {
      this.#clearDraft();
      return this.#validationMessage(validation);
    }

    const pendingId = randomUUID();
    this.pendingAction = { ...action, pendingId };
    this.#clearDraft();
    this.audit.record({
      ...auditBase(this.sessionId, "confirmation_requested"),
      pendingId,
      actionType: action.type,
      amount: action.amount,
      ...safeTarget(action),
    });
    const summary = action.type === "TRANSFER"
      ? `تحويل ${formatIqd(action.amount)} إلى ${action.recipientName}`
      : `دفع ${formatIqd(action.amount)} لـ${action.billerName} (${action.accountLabel}، رقم ${action.accountReference})`;
    return `راجع العملية: ${summary}. تريد تأكدها؟ جاوب «إي» للتنفيذ أو «لا» للإلغاء.`;
  }

  #handleRecipientChoice(message) {
    const normalized = normalizeText(message);
    const ordinal = ORDINALS.get(normalized);
    let chosen = ordinal === undefined ? null : this.draft?.recipientOptions?.[ordinal];
    if (!chosen) {
      const matches = this.wallet.findRecipients(normalized);
      if (matches.length === 1 && this.draft?.recipientOptions?.some((candidate) => candidate.id === matches[0].id)) {
        [chosen] = matches;
      }
    }
    if (!chosen) {
      return "ما كدرت أحدد منو تقصد. اكتب الاسم الكامل من الخيارات أو رقم الخيار.";
    }
    this.draft.recipientId = chosen.id;
    this.draft.recipientName = chosen.name;
    this.draft.recipientOptions = null;
    this.awaiting = null;
    return this.#resolveDraft();
  }

  #handlePendingConfirmation(message) {
    const normalized = normalizeText(message);
    if (CONFIRMATIONS.has(normalized)) {
      const action = this.pendingAction;
      this.pendingAction = null;
      const idempotencyKey = action.pendingId;
      this.audit.record({
        ...auditBase(this.sessionId, "execution_requested"),
        pendingId: action.pendingId,
        actionType: action.type,
        amount: action.amount,
        ...safeTarget(action),
      });
      const result = this.wallet.execute(action, idempotencyKey);
      if (!result.ok) {
        this.audit.record({ ...auditBase(this.sessionId, "execution_failed"), pendingId: action.pendingId, reason: result.reason });
        return this.#validationMessage(result);
      }
      this.audit.record({
        ...auditBase(this.sessionId, "execution_succeeded"),
        pendingId: action.pendingId,
        transactionId: result.transactionId,
        actionType: action.type,
        amount: action.amount,
        ...safeTarget(action),
      });
      return `تمت العملية التجريبية بنجاح. رقمها ${result.transactionId}، ورصيدك المتبقي ${formatIqd(result.balanceAfter)}.`;
    }
    if (CANCELLATIONS.has(normalized)) {
      const pendingId = this.pendingAction.pendingId;
      this.pendingAction = null;
      this.audit.record({ ...auditBase(this.sessionId, "action_cancelled"), pendingId });
      return "ألغيت العملية. ما انخصم أي مبلغ.";
    }
    const pendingId = this.pendingAction.pendingId;
    this.pendingAction = null;
    this.audit.record({ ...auditBase(this.sessionId, "confirmation_expired_by_non_answer"), pendingId });
    return "ما كانت إجابتك تأكيد أو إلغاء، فأنهيت الطلب المعلّق. ما تمت العملية؛ أرسل الطلب من جديد إذا تريدها.";
  }

  #ask(field, message) {
    this.awaiting = field;
    this.#auditClarification(field, this.draft?.amount ?? null);
    return message;
  }

  #auditClarification(field, amount, extra = {}) {
    this.audit.record({ ...auditBase(this.sessionId, "clarification_requested"), field, amount, ...extra });
  }

  #clearDraft() {
    this.draft = null;
    this.awaiting = null;
  }

  #validationMessage(validation) {
    switch (validation.reason) {
      case "insufficient_funds":
        return "رصيدك الحالي ما يكفي لهاي العملية. ما انخصم أي مبلغ.";
      case "bill_amount_mismatch":
        return `المبلغ المستحق هو ${formatIqd(validation.expected)}. ما تمت أي دفعة.`;
      case "invalid_recipient":
        return "ما كدرت أتحقق من المستلم، لذلك ما نفذت التحويل.";
      case "invalid_biller":
        return "ما كدرت أتحقق من خدمة الفاتورة، لذلك ما دفعتها.";
      default:
        return "ما كدرت أتحقق من تفاصيل العملية. ما انخصم أي مبلغ.";
    }
  }
}
