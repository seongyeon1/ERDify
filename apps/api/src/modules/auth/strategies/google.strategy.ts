import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import type { Request } from "express";
import { Strategy, Profile } from "passport-google-oauth20";

export interface GoogleValidateResult {
  providerId: string;
  providerEmail: string | undefined;
  name: string;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, "google") {
  private readonly configured: boolean;

  constructor(configService: ConfigService) {
    const clientID = configService.get<string>("GOOGLE_CLIENT_ID") ?? "not-configured";
    const clientSecret = configService.get<string>("GOOGLE_CLIENT_SECRET") ?? "not-configured";
    const callbackURL = configService.get<string>("GOOGLE_CALLBACK_URL") ?? "http://localhost/not-configured";
    super({ clientID, clientSecret, callbackURL, scope: ["email", "profile"] });
    this.configured = clientID !== "not-configured";
  }

  override authenticate(req: Request, options?: Record<string, unknown>): void {
    if (!this.configured) {
      this.fail({ message: "구글 로그인이 아직 준비되지 않았습니다." });
      return;
    }
    super.authenticate(req, options);
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: (error: Error | null, user?: GoogleValidateResult) => void,
  ): void {
    const providerId = String(profile.id);
    const providerEmail: string | undefined = profile.emails?.[0]?.value ?? undefined;
    const name: string = profile.displayName ?? "";
    done(null, { providerId, providerEmail, name });
  }
}
