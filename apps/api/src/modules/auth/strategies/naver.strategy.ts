import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import type { Request } from "express";
import { Strategy, Profile } from "passport-naver-v2";

export interface NaverValidateResult {
  providerId: string;
  providerEmail: string | undefined;
  name: string;
}

@Injectable()
export class NaverStrategy extends PassportStrategy(Strategy, "naver") {
  private readonly configured: boolean;

  constructor(configService: ConfigService) {
    const clientID = configService.get<string>("NAVER_CLIENT_ID") ?? "not-configured";
    const clientSecret = configService.get<string>("NAVER_CLIENT_SECRET") ?? "not-configured";
    const callbackURL = configService.get<string>("NAVER_CALLBACK_URL") ?? "http://localhost/not-configured";
    super({ clientID, clientSecret, callbackURL });
    this.configured = clientID !== "not-configured";
  }

  override authenticate(req: Request, options?: Record<string, unknown>): void {
    if (!this.configured) {
      this.fail({ message: "네이버 로그인이 아직 준비되지 않았습니다." });
      return;
    }
    super.authenticate(req, options);
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: (error: Error | null, user?: NaverValidateResult) => void,
  ): void {
    const providerId = String(profile.id);
    const providerEmail: string | undefined = profile.email ?? undefined;
    const name: string = profile.name ?? profile.nickname ?? "";
    done(null, { providerId, providerEmail, name });
  }
}
