import { Global, Module } from "@nestjs/common";
import { PERSISTENCE } from "../../shared/interfaces/persistence-port.interface.js";
import { RemotePersistence } from "./remote-persistence.js";
@Global()
@Module({
  providers: [
    RemotePersistence,
    { provide: PERSISTENCE, useExisting: RemotePersistence },
  ],
  exports: [PERSISTENCE, RemotePersistence],
})
export class PersistenceModule {}
