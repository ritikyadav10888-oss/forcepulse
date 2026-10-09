// Injection tokens for things that aren't classes.
export const DB = Symbol("DB");
export const CONFIG = Symbol("CONFIG");
export const CLOCK = Symbol("CLOCK");
export const OTP_SENDER = Symbol("OTP_SENDER");

/** Injected so tests can move time forward (OTP expiry, rate-limit windows, token lifetimes). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
