"use client";

import { useAuth } from "@/lib/auth";
import { rupees } from "@/lib/format";
import { btn, Message, useAction } from "./form";

interface Order {
  paymentId: string;
  razorpayOrderId: string;
  keyId: string;
  currency: string;
  entryFeePaise?: number;
  amountPaise?: number;
}

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open(): void };
  }
}

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => ok();
    s.onerror = () => fail(new Error("Couldn't load Razorpay. Check your connection."));
    document.body.appendChild(s);
  });
}

/**
 * Pays through Razorpay Checkout (FR-PAY-04). Razorpay adds the convenience fee for the chosen method.
 * The browser's result is only a hint: the server confirms with Razorpay before anything counts as paid.
 */
export function PayButton({ create, amountPaise, label = "Pay", onPaid }: { create: () => Promise<Order>; amountPaise: number; label?: string; onPaid: () => void }) {
  const { call, user } = useAuth();
  const { busy, error, run, setError } = useAction();

  async function pay() {
    const order = await run(create);
    if (!order) return;
    try {
      await loadCheckout();
    } catch (e) {
      return setError((e as Error).message);
    }
    new window.Razorpay!({
      key: order.keyId,
      order_id: order.razorpayOrderId,
      currency: order.currency,
      name: "Force Pulse",
      prefill: { contact: user?.phone ?? "" },
      theme: { color: "#0b1f3a" },
      handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
        void run(() => call("/payments/confirm", { method: "POST", body: { razorpayOrderId: r.razorpay_order_id, razorpayPaymentId: r.razorpay_payment_id, razorpaySignature: r.razorpay_signature } })).then(onPaid),
    }).open();
  }

  return (
    <div className="space-y-2">
      <button onClick={pay} disabled={busy} className={btn}>
        {busy ? "Opening payment…" : `${label} ${rupees(amountPaise)}`}
      </button>
      <p className="text-xs text-muted">A small convenience fee for the payment method is added by Razorpay. UPI is often free.</p>
      <Message error={error} />
    </div>
  );
}
