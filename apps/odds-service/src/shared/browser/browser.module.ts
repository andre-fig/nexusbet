import { LocalCdpService } from "./local-cdp.service.js";
import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module.js";
@Module({
  imports: [AppConfigModule],
  providers: [LocalCdpService],
  exports: [LocalCdpService],
})
export class BrowserModule {}
