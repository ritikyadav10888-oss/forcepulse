import { Logger } from "@nestjs/common";
import { maskMobile } from "@force-pulse/shared";

/** Delivers an OTP. The SMS/WhatsApp providers (MSG91 / Gupshup) plug in here once DLT approval is done. */
export interface OtpSender {
  /** True only for the development sender: the API then returns the code so the app can show it. */
  readonly exposesCode: boolean;
  send(phoneE164: string, code: string): Promise<void>;
}

/** Development only: prints the code to the server log. Refused in production by loadConfig. */
export class ConsoleOtpSender implements OtpSender {
  readonly exposesCode = true;
  private readonly log = new Logger("OTP");

  async send(phoneE164: string, code: string): Promise<void> {
    this.log.log(`OTP for ${maskMobile(phoneE164)}: ${code}`);
  }
}
