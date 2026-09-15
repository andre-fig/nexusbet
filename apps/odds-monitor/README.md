# Odds Monitor

Frontend interno de qualidade de dados, React/Vite/TypeScript strict. Dashboard, Event Detail e Needs Attention usam o odds-service; não existe mock/fallback em runtime.

```sh
npm ci
cp .env.example .env # apenas se não existir
npm run dev
```

Backend deve estar em PostgreSQL e autorizar a origin da UI em `ODDS_MONITOR_ORIGIN`. Configure `VITE_ODDS_SERVICE_URL` antes do build. Não há acesso direto ao banco, BFF ou endpoints de escrita.

```sh
npm run build
npm run typecheck
npm run lint
npm test
```

REST GET é a verdade; EventSource recebe invalidações pequenas e reconecta automaticamente. Sync é somente refresh de GETs. BEST PRICE, OUTLIER e ARBITRAGE são calculados no Monitor API do backend a partir de odds válidas; o frontend só renderiza os resultados e tooltips. Não há pricing ou consenso próprio. Providers são dinâmicos.

[Guia completo](../../docs/MONITOR.md): API, schemas, env, SSE, testes locais, limites e diagnóstico. Fixtures em `tests/fixtures` são apenas para testes; derivam de respostas reais sanitizadas de 2026-09-15.
