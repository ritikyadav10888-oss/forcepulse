// Injection tokens for things that aren't classes.
export const DB = Symbol("DB");
export const CONFIG = Symbol("CONFIG");
export const CLOCK = Symbol("CLOCK");
export const OTP_SENDER = Symbol("OTP_SENDER");
export const FILE_STORE = Symbol("FILE_STORE");

/** Injected so tests can move time forward (OTP expiry, rate-limit windows, token lifetimes). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
