import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppConfiguration, configuration } from "./configuration.js";
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: false,
      load: [configuration],
    }),
  ],
  providers: [AppConfiguration],
  exports: [AppConfiguration],
})
export class AppConfigModule {}
