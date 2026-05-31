import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import type { Request } from "express";
import { Strategy, Profile } from "passport-kakao";

export interface KakaoValidateResult {
  providerId: string;
  providerEmail: string | undefined;
  name: string;
}

@Injectable()
export class KakaoStrategy extends PassportStrategy(Strategy, "kakao") {
  private readonly configured: boolean;

  constructor(configService: ConfigService) {
    const clientID = configService.get<string>("KAKAO_CLIENT_ID") ?? "not-configured";
    const clientSecret = configService.get<string>("KAKAO_CLIENT_SECRET");
    const callbackURL = configService.get<string>("KAKAO_CALLBACK_URL") ?? "http://localhost/not-configured";
    super({ clientID, clientSecret, callbackURL });
    this.configured = clientID !== "not-configured";
  }

  override authenticate(req: Request, options?: Record<string, unknown>): void {
    if (!this.configured) {
      this.fail({ message: "카카오 로그인이 아직 준비되지 않았습니다." });
      return;
    }
    super.authenticate(req, options);
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: (error: Error | null, user?: KakaoValidateResult) => void,
  ): void {
    const providerId = String(profile.id);
    const kakaoAccount = (profile._json as { kakao_account?: { email?: string; profile?: { nickname?: string } } } | undefined)
      ?.kakao_account;
    const providerEmail: string | undefined = kakaoAccount?.email ?? undefined;
    const name: string = profile.displayName ?? kakaoAccount?.profile?.nickname ?? "";
    done(null, { providerId, providerEmail, name });
  }
}
