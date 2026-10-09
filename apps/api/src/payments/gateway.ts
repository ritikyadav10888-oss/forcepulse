import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "../common/api-error";

// Razorpay, behind an interface so tests run against a fake (test/fake-gateway.ts).

export interface GatewayOrder {
  id: string;
  amount: number;
  currency: "INR";
  receipt: string;
}

/** The fields of Razorpay's payment entity that Force Pulse uses. Amounts in paise. */
export interface GatewayPayment {
  id: string;
  order_id: string;
  /** What the player was charged, including the convenience fee under Customer Fee Bearer. */
  amount: number;
  /** Razorpay's charge, tax included. */
  fee: number | null;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  method?: string;
  error_description?: string | null;
}

export interface PaymentGateway {
  readonly keyId: string;
  createOrder(amountPaise: number, receipt: string, notes: Record<string, string>): Promise<GatewayOrder>;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  /** X-Razorpay-Signature over the raw webhook body. */
  verifyWebhook(rawBody: Buffer, signature: string): boolean;
  /** razorpay_signature returned to the browser by Checkout. */
  verifyCheckout(orderId: string, paymentId: string, signature: string): boolean;
}

export function hmacHex(secret: string, data: string | Buffer): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function safeEqualHex(expectedHex: string, givenHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(givenHex)) return false;
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(givenHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Talks to api.razorpay.com with the key id and secret (Basic auth). */
export class RazorpayGateway implements PaymentGateway {
  constructor(
    readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
    private readonly baseUrl = "https://api.razorpay.com/v1",
  ) {}

  createOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
    return this.call<GatewayOrder>("POST", "/orders", { amount: amountPaise, currency: "INR", receipt, notes });
  }

  fetchPayment(paymentId: string) {
    if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new ApiError("BAD_REQUEST", "Unknown payment.");
    return this.call<GatewayPayment>("GET", `/payments/${paymentId}`);
  }

  verifyWebhook(rawBody: Buffer, signature: string) {
    return safeEqualHex(hmacHex(this.webhookSecret, rawBody), signature);
  }

  verifyCheckout(orderId: string, paymentId: string, signature: string) {
    return safeEqualHex(hmacHex(this.keySecret, `${orderId}|${paymentId}`), signature);
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // Razorpay's message can name our account details; log it server-side only.
      console.error(`Razorpay ${method} ${path} failed: ${res.status} ${await res.text().catch(() => "")}`);
      throw new ApiError("PAYMENTS_UNAVAILABLE", "The payment service didn't respond. Please try again in a minute.");
    }
    return (await res.json()) as T;
  }
}

/** Used when Razorpay keys aren't set: every payment call says payments are unavailable. */
export class UnconfiguredGateway implements PaymentGateway {
  readonly keyId = "";
  private fail(): never {
    throw new ApiError("PAYMENTS_UNAVAILABLE", "Online payment isn't set up on this server yet.");
  }
  createOrder(): Promise<GatewayOrder> {
    this.fail();
  }
  fetchPayment(): Promise<GatewayPayment> {
    this.fail();
  }
  verifyWebhook() {
    return false;
  }
  verifyCheckout() {
    return false;
  }
}
