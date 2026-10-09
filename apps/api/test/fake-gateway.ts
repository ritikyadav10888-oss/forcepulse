import { hmacHex, safeEqualHex, type GatewayOrder, type GatewayPayment, type PaymentGateway } from "../src/payments/gateway";

/**
 * Stands in for Razorpay in tests. Signs webhooks and checkout callbacks with the same HMAC
 * Razorpay uses, and adds a Customer Fee Bearer convenience fee on top of the order amount.
 */
export class FakeGateway implements PaymentGateway {
  readonly keyId = "rzp_test_fake";
  readonly keySecret = "fake-key-secret";
  readonly webhookSecret = "fake-webhook-secret";
  readonly orders = new Map<string, GatewayOrder & { notes: Record<string, string> }>();
  readonly payments = new Map<string, GatewayPayment>();
  private seq = 0;

  async createOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
    const order = { id: `order_FAKE${++this.seq}`, amount: amountPaise, currency: "INR" as const, receipt, notes };
    this.orders.set(order.id, order);
    return order;
  }

  async fetchPayment(paymentId: string) {
    const p = this.payments.get(paymentId);
    if (!p) throw new Error(`fake: no payment ${paymentId}`);
    return p;
  }

  verifyWebhook(rawBody: Buffer, signature: string) {
    return safeEqualHex(hmacHex(this.webhookSecret, rawBody), signature);
  }

  verifyCheckout(orderId: string, paymentId: string, signature: string) {
    return safeEqualHex(hmacHex(this.keySecret, `${orderId}|${paymentId}`), signature);
  }

  /** Card at 2% + 18% GST on the order amount, charged to the player on top (₹1,000 → ₹23.60). */
  static cardFee(amount: number) {
    return Math.round(amount * 0.02 * 1.18);
  }

  /** The player pays: returns the webhook body + signature, and what Checkout hands the browser. */
  pay(orderId: string, opts: { fee?: number; status?: GatewayPayment["status"] } = {}) {
    const order = this.orders.get(orderId)!;
    const fee = opts.fee ?? FakeGateway.cardFee(order.amount);
    const payment: GatewayPayment = { id: `pay_FAKE${++this.seq}`, order_id: orderId, amount: order.amount + fee, fee, status: opts.status ?? "captured", method: "card" };
    this.payments.set(payment.id, payment);
    const event = payment.status === "failed" ? "payment.failed" : "payment.captured";
    const body = JSON.stringify({ event, payload: { payment: { entity: { ...payment, error_description: payment.status === "failed" ? "Card declined" : null } } } });
    return {
      payment,
      webhook: { body, signature: hmacHex(this.webhookSecret, body) },
      checkout: { razorpayOrderId: orderId, razorpayPaymentId: payment.id, razorpaySignature: hmacHex(this.keySecret, `${orderId}|${payment.id}`) },
    };
  }
}
