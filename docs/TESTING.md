# Testes e comandos

[Índice](../README.md#documentation) · Fonte: [package.json](../apps/odds-service/package.json).

## Rotina de regressão

Todos os comandos abaixo rodam em `apps/odds-service`. `npm ci` usa package-lock e executa Prisma generate no postinstall. TypeScript é strict/NodeNext; imports locais usam .js mesmo no source .ts.

```sh
npm run build
npm run typecheck
npm run format:check
npm test
```

Não há ESLint nem script lint neste backend. `format:check` é Prettier; não declare que executou lint por executá-lo. Não existe test:watch/dev no package atual. Nenhum script foi acrescentado apenas para preencher uma lista hipotética.

## Camadas de teste

| Local em src/modules | Cobertura e dependências |
|---|---|
| bet365/tests | Listagem/coupon/protocolo, IDs, layouts, odds, CDP e browser opcional |
| betano/tests | JSON, cobertura de competições, detalhes/mapas, flags, fixtures reais |
| superbet/tests | List/detail/dicionários, janela, IDs/unknown, transporte mock e scheduler |
| matching/tests | Aliases, orientação, dois/três providers, conflitos e unmatched |
| snapshots/tests | Mudanças, scopes, dedupe, suspensão e preservação temporal |
| collection/tests | Relógio falso, prioridade, limites, timeout, late publication, shutdown, Nest/API e headless |
| persistence/tests/postgres.integration.ts | Banco real separado, constraints, transações, precisão, restore, matching, issues, importação e API |

`npm test` força PERSISTENCE_MODE=file e usa node:test via tsx. Testes comuns usam mocks/fixtures e arquivos temporários, sem bookmakers reais ou PostgreSQL. Fixtures JSON são dados de teste essenciais, mesmo em um projeto TypeScript; não remova por extensão.

## Browser opcional

```sh
npm run test:browser
# Cobertura opcional mais ampla, incluindo collection/tests/headless.test.ts:
BROWSER_TESTS=1 npm test
```

Chrome precisa estar instalado. test:browser executa somente bet365/tests/browser-feed.test.ts; a segunda forma habilita todos os testes opcionais da suíte normal. Browser usa Chrome invisível e feeds locais interceptados, não conta de bookmaker nem captura real. Portanto aprovação não valida acesso atual aos sites. Sem BROWSER_TESTS=1, casos dependentes de browser são skipped deliberadamente.

## Integração PostgreSQL

A suíte SQL **trunca tabelas**. Use banco descartável cujo nome termine em `_test`, nunca banco de trabalho/produção. Exemplo para o Compose e placeholders locais:

```sh
docker compose up -d
# Criar uma única vez; adapte usuário/nome ao seu .env:
docker compose exec postgres createdb -U odds odds_service_test
# Exemplo local, não credencial real:
TEST_DATABASE_URL=postgresql://odds:local_development_only@127.0.0.1:5433/odds_service_test npm run test:db
```

O script carrega dotenv e exige TEST_DATABASE_URL no ambiente ou .env; o ambiente explícito tem precedência. Ele direciona DATABASE_URL para esse banco, aplica migrations e limpa fixtures entre testes. Testa odds 1.72→1.70→1.68, precisão numeric, seed/upsert idempotente, rollback, histórico append-only, canonical/matches/issues, timestamps/scopes, importação e restart. Não executa coleta remota.

## Inventário de scripts reais

| Script npm run | Efeito |
|---|---|
| start | Nest via tsx; sem watch |
| start:prod | Executa dist/main.js; exige build |
| build | Limpa dist e compila tsconfig.build.json |
| typecheck | tsc conforme tsconfig |
| test | Suíte normal em modo file |
| test:browser | Subconjunto Bet365 com browser local |
| test:db | Integração SQL destrutiva em banco de teste explícito |
| format / format:check | Reescreve / verifica formatação src/**/*.ts |
| capture / capture:betano / capture:superbet | CLI de uma rodada, publica inboxes |
| collect / collect:betano | Loop CLI legado; encerrar após diagnóstico |
| db:generate | Gera Prisma client ignorado pelo Git |
| db:migrate | prisma migrate deploy; aplica migrations versionadas |
| db:seed | Seed idempotente dos três providers |
| db:status | Estado das migrations |
| db:import-legacy | Simulação/importação explícita de capturas |
| postinstall | Prisma generate automático após instalação |

Flags CLI, impactos e separação do scheduler em [Operations](OPERATIONS.md). Não existem scripts antigos check/normalize/replay-snapshots, reset, lint ou collect:superbet; para Superbet em loop o CLI suporta `npm run capture:superbet -- --loop`, embora o scheduler Nest seja o caminho contínuo preferido.

## Como alterar com segurança

Parser: acrescente fixture sanitizada da variação e testes positivos/negativos, mantendo fixtures antigas. Matcher: teste concorrente ambíguo e orientação invertida. Scheduler: use relógio/controladores mock, não waits de vários minutos. Persistência: inclua falha no meio da transação, repetição, restore e timestamps originais.

Antes de merge rode build/typecheck/formatação/suíte normal. Para browser alterado, habilite casos opcionais; para banco, execute test:db. Diferencie skip de pass e validação real de fixture. Validação de sites é opcional e limitada, não parte da rotina CI; não mantenha polling indefinido nem contorne proteção para satisfazer teste.

## Validação desta revisão documental

Build, typecheck e format:check passaram. `BROWSER_TESTS=1 npm test`: 90/90, sem skips; `test:db`: 23/23 em PostgreSQL descartável. Total 113 testes aprovados. Links relativos de arquivos e cobertura das variáveis da configuração central no .env.example foram conferidos. Não houve coleta remota nessa validação nem alteração de parser/regra de negócio. Esses resultados são um registro da revisão, não garantia permanente de disponibilidade dos sites.
