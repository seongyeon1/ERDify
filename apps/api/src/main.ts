import "reflect-metadata";
import { join } from "path";
import cookieParser from "cookie-parser";
import compression from "compression";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  app.useBodyParser("json", { limit: "50mb" });
  app.useBodyParser("urlencoded", { limit: "50mb", extended: true } as Parameters<typeof app.useBodyParser>[1]);

  app.use(compression());
  app.use(cookieParser());
  app.useWebSocketAdapter(new IoAdapter(app));

  app.enableCors({
    origin: process.env["NODE_ENV"] === "production"
      ? (process.env["CORS_ORIGINS"]?.split(",") ?? [])
      : true,
    credentials: true,
  });

  app.setGlobalPrefix("api");
  app.useStaticAssets(join(__dirname, "..", "uploads"), { prefix: "/uploads" });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );

  const port = Number(process.env["API_PORT"] ?? 4000);
  await app.listen(port);
}

void bootstrap();
