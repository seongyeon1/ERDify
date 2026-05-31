import globals from "globals";
import base from "./base.js";

export default [
  ...base,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node
      }
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      // TS가 미정의 식별자를 검사하므로 끈다. 전역 네임스페이스 타입(Express.Multer.File 등)의 오탐 방지 (typescript-eslint 권장).
      "no-undef": "off",
      // NestJS DI는 생성자에 주입되는 클래스의 "런타임 값"이 필요하다(emitDecoratorMetadata).
      // consistent-type-imports가 이를 `import type`으로 바꾸면 의존성 주입이 깨지므로 Nest 앱에서는 끈다.
      "@typescript-eslint/consistent-type-imports": "off"
    }
  }
];
