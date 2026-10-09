import { Body, Controller, HttpCode, Ip, Post, Headers } from "@nestjs/common";
import { z } from "zod";
import { Authenticated, CurrentAuth, Public, type AuthContext } from "../common/policy";
import { parse } from "../common/validate";
import { AuthService } from "./auth.service";

const SendOtp = z.object({ phone: z.string().min(1, "Enter your mobile number") });
const VerifyOtp = z.object({ phone: z.string().min(1), code: z.string().trim().min(1, "Enter the code") });
const StaffLogin = z.object({ email: z.string().email(), password: z.string().min(1) });
const Refresh = z.object({ refreshToken: z.string().min(1) });

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("otp")
  @HttpCode(200)
  @Public()
  sendOtp(@Body() body: unknown, @Ip() ip: string) {
    const { phone } = parse(SendOtp, body);
    return this.auth.sendOtp(phone, ip || null);
  }

  @Post("verify")
  @HttpCode(200)
  @Public()
  verifyOtp(@Body() body: unknown, @Headers("user-agent") userAgent?: string) {
    const { phone, code } = parse(VerifyOtp, body);
    return this.auth.verifyOtp(phone, code, userAgent ?? null);
  }

  @Post("staff/login")
  @HttpCode(200)
  @Public()
  staffLogin(@Body() body: unknown, @Headers("user-agent") userAgent?: string) {
    const { email, password } = parse(StaffLogin, body);
    return this.auth.staffLogin(email, password, userAgent ?? null);
  }

  @Post("refresh")
  @HttpCode(200)
  @Public()
  refresh(@Body() body: unknown) {
    return this.auth.refresh(parse(Refresh, body).refreshToken);
  }

  @Post("logout")
  @HttpCode(204)
  @Authenticated()
  async logout(@CurrentAuth() auth: AuthContext) {
    await this.auth.logout(auth.sessionId);
  }
}
