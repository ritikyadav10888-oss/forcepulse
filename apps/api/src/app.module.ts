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
import { CLOCK, CONFIG, DB, FILE_STORE, OTP_SENDER, PAYMENT_GATEWAY, systemClock, type Clock } from "./common/tokens";
import type { AppConfig } from "./config";
import { FixturesController } from "./fixtures/fixtures.controller";
import { FixturesService } from "./fixtures/fixtures.service";
import { GalleryController } from "./gallery.controller";
import { HealthController } from "./health.controller";
import { MeController } from "./me/me.controller";
import { PlayersController } from "./players/players.controller";
import { PlayersService } from "./players/players.service";
import { RolesService } from "./roles/roles.service";
import { RazorpayGateway, UnconfiguredGateway, type PaymentGateway } from "./payments/gateway";
import { PaymentsController } from "./payments/payments.controller";
import { PaymentsService } from "./payments/payments.service";
import { PayoutAccountsService } from "./payments/payout-accounts.service";
import { PayoutsService } from "./payments/payouts.service";
import { PincodesController } from "./pincodes.controller";
import { RegistrationsController } from "./registrations/registrations.controller";
import { RegistrationsService } from "./registrations/registrations.service";
import { ScoringController } from "./scoring/scoring.controller";
import { ScoringService } from "./scoring/scoring.service";
import { SportsController } from "./sports/sports.controller";
import { TournamentsController } from "./tournaments/tournaments.controller";
import { TournamentsService } from "./tournaments/tournaments.service";
import { LocalFileStore, type FileStore } from "./uploads/file-store";
import { UploadsController } from "./uploads/uploads.controller";
import { UploadsService } from "./uploads/uploads.service";

export interface AppDeps {
  config: AppConfig;
  db: DbHandle;
  clock?: Clock;
  otpSender?: OtpSender;
  fileStore?: FileStore;
  gateway?: PaymentGateway;
}

/** One module for now. It splits into Core / Scoring / Auction / Payments modules as those arrive. */
@Module({})
export class AppModule {
  static register(deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      imports: [JwtModule.register({ secret: deps.config.jwtSecret })],
      controllers: [
        HealthController,
        AuthController,
        MeController,
        PlayersController,
        SportsController,
        AdminController,
        TournamentsController,
        RegistrationsController,
        UploadsController,
        PincodesController,
        PaymentsController,
        FixturesController,
        GalleryController,
        ScoringController,
      ],
      providers: [
        { provide: CONFIG, useValue: deps.config },
        { provide: DB, useValue: deps.db.db },
        { provide: CLOCK, useValue: deps.clock ?? systemClock },
        { provide: OTP_SENDER, useValue: deps.otpSender ?? new ConsoleOtpSender() },
        { provide: FILE_STORE, useValue: deps.fileStore ?? new LocalFileStore(deps.config.uploadDir) },
        { provide: PAYMENT_GATEWAY, useValue: deps.gateway ?? gatewayFor(deps.config) },
        { provide: APP_GUARD, useClass: PolicyGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
        AuditService,
        EventBus,
        RolesService,
        OtpService,
        TokensService,
        AuthService,
        PlayersService,
        TournamentsService,
        RegistrationsService,
        UploadsService,
        PaymentsService,
        PayoutsService,
        PayoutAccountsService,
        FixturesService,
        ScoringService,
      ],
    };
  }
}

function gatewayFor(config: AppConfig): PaymentGateway {
  const rp = config.razorpay;
  return rp ? new RazorpayGateway(rp.keyId, rp.keySecret, rp.webhookSecret) : new UnconfiguredGateway();
}
