import { IsString, IsOptional, IsObject, MinLength, MaxLength } from "class-validator";

export class AiChatStreamDto {
  @IsString()
  @MinLength(1)
  diagramId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  model?: string;

  // 에디터의 라이브 문서. 보내면 DB content(스냅샷·지연 가능) 대신 이걸 기준으로 분석/수정한다.
  @IsOptional()
  @IsObject()
  document?: Record<string, unknown>;
}

export class AiCreateSessionDto {
  @IsString()
  @MinLength(1)
  diagramId!: string;
}

export interface AiSessionResponse {
  id: string;
  diagramId: string;
  name: string;
  createdAt: string;
}
