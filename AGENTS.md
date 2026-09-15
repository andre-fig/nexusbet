# Project Overview

NexusBet contém o backend NestJS de leitura `apps/odds-service`: odds pré-jogo de CS2, LoL e Valorant de Bet365, Betano, Superbet, Blaze e EstrelaBet. Coleta, normaliza, publica snapshots, preserva histórico PostgreSQL/journal e compara eventos. Não implementa apostas, pagamentos, carteira, BFF ou live. `apps/odds-monitor` é separado e usa mocks; não é dependência do backend.

Leia [README](README.md), depois o documento da área em [docs](docs/ARCHITECTURE.md). Código, schema, migrations e testes atuais são a fonte principal; registre divergências em vez de mudar comportamento para corresponder a uma descrição antiga.

# Architecture

Todos os caminhos abaixo partem de `apps/odds-service`:

- `src/main.ts`, `bootstrap.ts`, `app.module.ts`: bootstrap Nest e API GET local.
- `src/modules/bet365`, `betano`, `superbet`, `blaze`, `estrelabet`: service/client/collector/parser, stores, fixtures e testes específicos.
- `src/modules/collection`: registry, orquestração, agenda adaptativa e CLI.
- `src/modules/snapshots`: snapshots e journal comum.
- `src/modules/matching`: comparação do domínio; não interpreta protocolos.
- `src/modules/database`: conexão Prisma, verificação de migrations e seed.
- `src/modules/persistence`: transações, repositories, sanitização, consultas e importação.
- `src/modules/health`: estado operacional agregado.
- `src/shared/{domain,interfaces,browser,errors,types,utils}` e `src/config`: contratos e infraestrutura neutra.
- `prisma/schema.prisma`, `prisma/migrations`: banco versionado; cliente gerado ignorado em `src/generated/prisma`.

Não crie camadas vazias ou reorganize em MVC. Veja [Architecture](docs/ARCHITECTURE.md).

# Provider Isolation

Os cinco providers são contextos independentes. Não importe parser/store de outro bookmaker. Protocolo, IDs de navegação, mapeamentos e validações ficam no módulo correspondente. Compartilhe domínio e infraestrutura neutra, como a conexão CDP; não transforme formatos diferentes em um parser universal. Providers não importam Prisma/SQL: usam a porta de persistência pelo pipeline existente.

# Normalized Domain

Os nomes reais são `NormalizedEvent extends DetailedMatch`, `Market`, `Selection`, `ProviderEventRef` e `OddsProvider`/`ProviderRuntime`, em `src/shared`. Não existem interfaces chamadas `NormalizedMarket` ou `NormalizedSelection`. O identificador externo do evento é `eventId`; `marketId` pode ser uma chave composta e `rawMarketId` preserva o original.

`CanonicalEvent` é modelo Prisma; a comparação pura retorna um objeto `canonicalEvent`, sem UUID persistente. Não misture esse objeto com a entidade SQL. Confira [Data model](docs/DATA_MODEL.md) antes de alterar contratos.

# Critical Domain Rules

- Identidade externa: provider + eventId; IDs externos são strings e não são UUIDs internos do banco.
- `EventRemoved != EventFinished`. Ausência/horário decorrido não autorizam liquidação ou status final.
- Novas observações não destroem odds anteriores. Preserve fetchedAt, scopes e timestamps de cada mercado/aba.
- Uma captura parcial não deve substituir um scope completo nem remover seus mercados.
- Matching só une grupos não ambíguos. Preserve nomes brutos, aliases explícitos, competição, esporte e horário.
- Falha de provider preserva o último estado válido e não derruba outros providers. Não aumente TTL para ocultar falhas.
- Odd null é informação, não zero; respeite suspensão e validação do parser.
- Nunca persista credenciais, cookies, tokens ou headers sensíveis em raw/proveniência.

# Collection / Scheduler

A agenda tem poucos timers globais e estado em memória. Discovery padrão 60s; detalhe 10min/5min/2min/1min conforme proximidade. Eventos iniciados deixam a agenda pré-jogo. Concorrência **efetiva 1 por provider**, mesmo com configuração maior; providers podem rodar em paralelo. Locks abrangem listagem e detalhe.

Timeout aborta transporte, mas aguarda drenagem antes de liberar lock. Commit iniciado não é abortado. Backoff 30/60/120/300s; cinco falhas consecutivas abrem cooldown 300s. Preserve shutdown e isolamento. Use uma instância escritora: não há lock distribuído. Defaults e limites: [Collection](docs/COLLECTION.md).

# Persistence

Prisma único ORM, PostgreSQL 16 local, migrations obrigatórias. Startup valida migrations antes da coleta. `event_matches` é a única fonte de vínculo canônico atual; `match_decisions` guarda histórico. Não adicione FK canônica redundante em provider_events.

Upserts preservam entidades; snapshots append-only usam numeric(24,12). Cada scope/publicação é transacional. Banco confirma antes de journal em arquivo/memória; não há transação distribuída arquivo+SQL. Journals e checkpoints são legado ainda necessário. Nunca remova-os sem uma migração específica e testes de equivalência/restart. Veja [Odds history](docs/ODDS_HISTORY.md).

# Matching

`compareAllProviders` usa nomes normalizados e aliases explícitos, mesma competição/esporte, status scheduled e tolerância de 15min. Exige compatibilidade de todos os pares e no máximo um evento por provider. Confidence 1 é resultado da regra, não probabilidade. Partial/low_confidence/manual existem no schema, mas não são workflows automáticos completos. [Matching](docs/MATCHING.md) detalha o algoritmo.

# Testing / Commands

Execute os comandos em `apps/odds-service`, não na raiz:

```sh
npm ci
npm run build
npm run typecheck
npm run format:check
npm test
```

Antes de merge, os checks acima devem passar. Alterações em persistência exigem `npm run test:db` com `TEST_DATABASE_URL` de banco **descartável terminado em _test**: a suíte aplica migrations e TRUNCATE. Nunca aponte para banco útil. Browser opcional: `BROWSER_TESTS=1 npm test` usa Chrome invisível/feeds locais, sem bookmaker real. Preserve fixtures reais, não ajuste odds/IDs para mascarar regressão.

Comandos operacionais: `npm start`, `npm run start:prod`, `db:generate`, `db:migrate`, `db:seed`, `db:status`. Captura: `capture`, `capture:betano`, `capture:superbet`, `capture:blaze`, `capture:estrelabet`; loops CLI legados: `collect`, `collect:betano`. Importação opcional: `db:import-legacy`. `format` modifica arquivos; `format:check` só verifica. Lista completa/efeitos: [Testing](docs/TESTING.md).

# Development Rules

- Preserve TypeScript strict, ESM e imports locais `.js`; evite any sem motivo.
- Não reescreva parsers funcionais nem esconda falhas de estrutura com arrays vazios.
- Não altere fixtures/IDs externos sem evidência e teste de regressão.
- Gere nova migration para mudanças no banco; não edite migration aplicada nem use db push ou synchronize para contornar checksums.
- Não edite cliente Prisma ou dist gerados.
- Mantenha configurações centralizadas e documente env/defaults novos.
- Não adicione infraestrutura pesada, dependência entre apps ou abstrações vazias.
- Alterações de documentação não autorizam alterações de negócio. Preserve trabalho existente e documentação útil.

# Security

Coleta somente leitura. Nunca commite `credentials.txt`, `.env`, perfis Chrome ou capturas com segredos. Não logue login/senha/cookies/tokens; use sanitizador antes de persistir raw. Não automatize apostas, CAPTCHA, 2FA ou contorno anti-bot.

Bet365/Betano usam somente `BROWSER_RUNTIME=local-cdp` no macOS, Chrome pessoal/headed já funcional. `LocalCdpService` cria/reutiliza exclusivamente targets próprios; nunca navegue/feche tabs preexistentes, encerre Chrome/contexto pessoal, copie cookies, altere storage ou faça logout. Não há launch nem fallback. Fora de local-cdp/macOS, ficam disabled/unavailable. Em Railway, BET365_ENABLED=false e BETANO_ENABLED=false. Não retome investigação headless/Linux/Xvfb/replay HTTP nesta etapa. Relatórios históricos não autorizam novos experimentos. Veja [Local CDP](docs/LOCAL_CDP.md).

# How to Add a New Provider

1. Leia o contrato real `OddsProvider` e a extensão `ProviderRuntime`.
2. Crie módulo/service/client/collector/parser e store específicos; separe mapper apenas onde útil.
3. Capture feeds reais de leitura sem login inicialmente; preserve cobertura e sanitização.
4. Implemente listagem, detalhe, leitura, refresh, health, seleção manual e fechamento/abort.
5. Adicione fixtures sanitizadas e testes para IDs, mapas, suspensão, unknown e cobertura parcial.
6. Atualize unions de provider/domínio, registry/DI em CollectionModule e configuração de concorrência.
7. Integre scopes, snapshots, TTL e publicação diferida; teste timeout/shutdown.
8. Verifique health e matching genérico com um, dois e três providers; não crie matcher par-a-par.
9. Atualize seed idempotente e documentação; cadastrar linha SQL sozinho não cria coletor.
10. Valide dados reais e UI quando permitidos, distinguindo ausência de mercado de falha de transporte.

Checklist técnico: [Providers](docs/PROVIDERS.md).

# Common Failure Modes

| Sintoma | Primeiro ponto de investigação |
|---|---|
| Zero eventos/bloqueio | provider client/collector, logs, status HTTP e cobertura; não apague catálogo |
| Estrutura desconhecida/odds null | parser e fixture equivalente; preserve erro e raw sanitizado |
| Dados stale | health, fetchedAt, fila/backoff/cooldown; depois TTL |
| Muitos unmatched | aliases e regras em matching.ts/shared/utils/names.ts |
| Snapshots parados | store → PersistencePort → transaction → journal; migrations e logs |
| Duplicatas | chave provider:eventId e scope, validação de conflito do parser |
| Startup SQL falha | db:status, conexão, migration versionada/checksum |

Procedimentos: [Operations](docs/OPERATIONS.md).

# Do Not

Não apostar, inferir finished por ausência, apagar histórico, misturar protocolos, relaxar validações para passar testes, iniciar polling indefinidamente para documentar ou implementar frontend/BFF/risk engine por iniciativa própria. Não apresentar deploy Railway, Sentry ou dashboard integrado como validados: o runtime está preparado, a implantação remota exige validação. Veja [produção](docs/PRODUCTION_RUNTIME.md).

Diagnóstico de browser: [HEADLESS_DIAGNOSTICS.md](docs/HEADLESS_DIAGNOSTICS.md). `browser:diagnose` não publica snapshots; `browser:compare` compara metadados sanitizados. A validação atual usa targets próprios no Chrome pessoal existente; não copia cookies.

Blaze usa HTTP anônimo e snapshot completo fragmentado, sem browser. Respeite a cadeia de versões e a conclusão antes da publicação; não confunda o endpoint individual bloqueado com o feed completo funcional. [Guia Blaze](docs/BLAZE.md).

EstrelaBet usa HTTP Altenar anônimo: todas as páginas GetUpcoming antes da publicação e GetEventDetails para detalhes. Preserve IDs, precisão original (UI trunca a duas casas), tipos 30001/330/395 e sv de mapa. Sem fallback de browser. [Guia EstrelaBet](docs/ESTRELABET.md).
