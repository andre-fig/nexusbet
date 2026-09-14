# NexusBet

O backend NestJS está em [apps/odds-service](apps/odds-service/README.md). Consulte esse README para configurar PostgreSQL, executar migrations e iniciar a coleta.

```sh
cd apps/odds-service
npm ci
npm run build
npm start
```

Bet365 e Betano usam Chrome headless por padrão; Superbet usa HTTP público. Limitações de acesso em headless estão documentadas no README do serviço. A coleta é controlada por `COLLECTION_ENABLED`. `apps/odds-monitor` é uma aplicação separada e não é dependência do serviço.
