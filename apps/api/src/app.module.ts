import { DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import type { DbHandle } from "@force-pulse/db";
import { AdminController } from "./admin/admin.controller";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { ConsoleOtpSender, type OtpSender } from "./auth/otp-sender";
import { OtpService } from "./auth/otp.service";
import { PolicyGuard } from "./auth/policy.guard";
import { TokensService } from "./auth/tokens.service";
import { AuditService } from "./common/audit.service";
import { ErrorFilter } from "./common/error.filter";
import { EventBus } from "./common/event-bus";
import { CLOCK, CONFIG, DB, OTP_SENDER, systemClock, type Clock } from "./common/tokens";
import type { AppConfig } from "./config";
import { HealthController } from "./health.controller";
import { MeController } from "./me/me.controller";
import { PlayersController } from "./players/players.controller";
import { PlayersService } from "./players/players.service";
import { RolesService } from "./roles/roles.service";
import { SportsController } from "./sports/sports.controller";

export interface AppDeps {
  config: AppConfig;
  db: DbHandle;
  clock?: Clock;
  otpSender?: OtpSender;
}

/** One module for week 1. It splits into Core / Scoring / Auction / Payments modules as those arrive. */
@Module({})
export class AppModule {
  static register(deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      imports: [JwtModule.register({ secret: deps.config.jwtSecret })],
      controllers: [HealthController, AuthController, MeController, PlayersController, SportsController, AdminController],
      providers: [
        { provide: CONFIG, useValue: deps.config },
        { provide: DB, useValue: deps.db.db },
        { provide: CLOCK, useValue: deps.clock ?? systemClock },
        { provide: OTP_SENDER, useValue: deps.otpSender ?? new ConsoleOtpSender() },
        { provide: APP_GUARD, useClass: PolicyGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
        AuditService,
        EventBus,
        RolesService,
        OtpService,
        TokensService,
        AuthService,
        PlayersService,
      ],
    };
  }
}
