import type {
  ApplePayPayment,
  ApplePayStore,
  NewPayment,
} from "../../src/apple-pay/store.js";

// An in-memory payments store (Apple Pay and bank emails) for tests. The
// day's total is one number, enough to check the messages.
export class MemoryPayments implements ApplePayStore {
  rows: ApplePayPayment[] = [];
  dayTotal = 0;

  async recentDuplicate(
    p: Pick<NewPayment, "amountText" | "merchant" | "card">,
    since: Date,
  ) {
    return (
      this.rows.find(
        (r) =>
          r.amountText === p.amountText &&
          r.merchant === p.merchant &&
          r.card === p.card &&
          r.receivedAt >= since,
      ) ?? null
    );
  }
  async countOn(spendDate: string) {
    return this.rows.filter((r) => r.spendDate === spendDate).length;
  }
  async record(value: NewPayment) {
    const { askFirst, ...fields } = value;
    const counted = value.amountCents !== null && !askFirst;
    const payment: ApplePayPayment = {
      ...fields,
      source: value.source ?? "applepay",
      kind: value.kind ?? "",
      externalRef: value.externalRef ?? null,
      readByAi: value.readByAi ?? false,
      id: this.rows.length + 1,
      status: counted
        ? "counted"
        : value.amountCents === null
          ? "awaiting_sgd"
          : "awaiting_ok",
      createdAt: value.receivedAt,
    };
    this.rows.push(payment);
    if (!counted) return { payment, dayTotalCents: null };
    this.dayTotal += value.amountCents!;
    return { payment, dayTotalCents: this.dayTotal };
  }
  async convert(id: number, cents: number) {
    const payment = this.rows.find(
      (r) => r.id === id && r.status === "awaiting_sgd",
    );
    if (!payment) return null;
    Object.assign(payment, { status: "counted", amountCents: cents });
    this.dayTotal += cents;
    return { payment, dayTotalCents: this.dayTotal };
  }
  async confirm(id: number) {
    const payment = this.rows.find(
      (r) => r.id === id && r.status === "awaiting_ok",
    );
    if (!payment || payment.amountCents === null) return null;
    payment.status = "counted";
    this.dayTotal += payment.amountCents;
    return { payment, dayTotalCents: this.dayTotal };
  }
  async undo(id: number) {
    const payment = this.rows.find(
      (r) => r.id === id && r.status === "counted",
    );
    if (!payment) return null;
    payment.status = "undone";
    this.dayTotal -= payment.amountCents ?? 0;
    return { payment, dayTotalCents: this.dayTotal };
  }
  async skip(id: number) {
    const payment = this.rows.find(
      (r) =>
        r.id === id &&
        (r.status === "awaiting_sgd" || r.status === "awaiting_ok"),
    );
    if (payment) payment.status = "skipped";
    return payment ?? null;
  }
  async requestSgd(id: number, until: Date) {
    const payment = this.rows.find(
      (r) =>
        r.id === id &&
        (r.status === "awaiting_sgd" || r.status === "awaiting_ok"),
    );
    if (payment) {
      payment.status = "awaiting_sgd";
      payment.sgdRequestedUntil = until;
    }
    return payment ?? null;
  }
  async awaitingSgd(now: Date) {
    return (
      this.rows.find(
        (r) =>
          r.status === "awaiting_sgd" &&
          r.sgdRequestedUntil !== null &&
          r.sgdRequestedUntil > now,
      ) ?? null
    );
  }
  async findByRef(externalRef: string) {
    return this.rows.find((r) => r.externalRef === externalRef) ?? null;
  }
  async waitingCount() {
    return this.rows.filter(
      (r) => r.status === "awaiting_sgd" || r.status === "awaiting_ok",
    ).length;
  }
  async daySummary() {
    return { count: 0, cents: 0 };
  }
  async inRange() {
    return this.rows;
  }
  async latest() {
    return this.rows.at(-1) ?? null;
  }
}
