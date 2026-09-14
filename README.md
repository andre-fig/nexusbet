# NexusBet

O backend de coleta de odds está em [apps/odds-service](apps/odds-service/README.md).

```sh
cd apps/odds-service
npm ci
npm run build
npm start
```

O scheduler começa automaticamente. Bet365 e Betano precisam do Chrome com CDP autorizado; Superbet usa HTTP direto sem login. Para iniciar somente a API, use `COLLECTION_ENABLED=false npm start`.

As pastas `apps/bff` e `apps/web` estão reservadas; esta aplicação não depende delas.
