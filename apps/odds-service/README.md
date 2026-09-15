# Odds Service

> Runtime atual: [server + collector-agent](../../docs/RUNTIMES.md). Todos os cinco coletores rodam no PC; Railway recebe ingestão autenticada e não coleta. As descrições de processo único/coleta HTTP no Railway abaixo são históricas.

## Runtime suportado: desenvolvimento local

Bet365 e Betano usam exclusivamente **`BROWSER_RUNTIME=local-cdp` no macOS**, conectando ao Chrome headed existente e gerenciando somente suas próprias tabs. **Linux/Xvfb e headless não são suportados** para esses providers. Em Railway: `BET365_ENABLED=false`, `BETANO_ENABLED=false`, `BROWSER_RUNTIME=disabled`. Superbet, Blaze e EstrelaBet mantêm HTTP independente.

Preparação do Chrome, flags, ownership, indisponibilidade e shutdown: [Local CDP](../../docs/LOCAL_CDP.md).


Backend NestJS somente leitura para odds pré-jogo de CS2, LoL e Valorant, com providers independentes Bet365, Betano, Superbet, Blaze e EstrelaBet, scheduler adaptativo, snapshots persistentes e matching conservador. Usa PostgreSQL com Prisma e ingestão direta; arquivos ficam restritos a debug/replay/import legado. Não depende de frontend ou BFF.

Guia de entrada: [README da raiz](../../README.md). Instruções de trabalho: [AGENTS.md](../../AGENTS.md). Documentação aprofundada: [índice](../../README.md#documentation).

## Executar

A partir da raiz do repositório:

```sh
cd apps/odds-service
npm ci
# Configure .env a partir de .env.example (somente se ainda não existir).
docker compose up -d
npm run db:migrate
npm run db:seed
npm run build
npm start
# Ou executar o build compilado:
npm run start:prod
```

Execute apenas uma instância de cada vez. A API atende em `127.0.0.1:3650` por padrão (`PORT`). Com COLLECTION_ENABLED=true, o scheduler começa automaticamente após o startup delay. Para somente API/ingestão, sem coletar nos sites:

```sh
COLLECTION_ENABLED=false npm start
```

Bet365/Betano usam `BROWSER_RUNTIME=local-cdp` no macOS. O serviço não inicia outro Chrome nem fecha o Chrome pessoal; Superbet, Blaze e EstrelaBet mantêm HTTP público.

Use [LOCAL_CDP.md](../../docs/LOCAL_CDP.md) para desenvolvimento local. Em produção, BET365_ENABLED=false, BETANO_ENABLED=false e BROWSER_RUNTIME=disabled. Relatórios de Xvfb permanecem históricos.

A validação real usa o mesmo runtime local-cdp, parser e rotas. Flags HEADLESS/BROWSER_MODE não selecionam alternativas para os dois providers.

O exemplo local inicia com `COLLECTION_ENABLED=false`. Use `COLLECTION_ENABLED=true npm start` para coleta contínua. Instalação, schema, migrations, importação, consultas e limitações: [PostgreSQL](docs/postgres.md).

## Verificação

```sh
npm run build
npm run typecheck
npm test
npm run test:browser
npm run format:check
# Integração SQL, com TEST_DATABASE_URL configurada para um banco *_test:
npm run test:db
# Suíte completa, incluindo browser opcional com feeds locais:
BROWSER_TESTS=1 npm test
```

Testes comuns usam mocks/fixtures e não consultam as casas. Fixtures e testes ficam dentro dos módulos em `src/modules/*/`.

## API

Somente GET; rotas normalizadas retornam 503 para dados ausentes/vencidos, demais métodos retornam 405. Consultas SQL são históricas e não aplicam esse TTL automaticamente.

- `/health`: saúde operacional, scheduler, providers e estado da conexão de persistência.
- `/events`, `/providers`, `/provider-events`, `/issues`, `/selections/:id/odds-history`: consultas persistentes PostgreSQL; limites e semântica em [docs/postgres.md](docs/postgres.md).
- `/providers/bet365/events`, `/providers/betano/events` e `/providers/superbet/events`: domínio normalizado comum.
- `/providers/{provider}/events/:id`: detalhe; `?esport=cs2`, `lol` ou `valorant` restringe a modalidade.
- `/providers/{provider}/health`: estado do provider.
- `/comparisons` e `/matching/unmatched`: matching conservador entre fontes.
- `/matches`, `/matches/:id` e `/provenance`: contratos históricos bet365.
- `/providers/{provider}/matches` e detalhes: aliases compatíveis de events.

## Dados e configuração

ConfigModule lê variáveis do ambiente e `.env`; nunca lê credentials.txt. Diretórios relativos são resolvidos a partir do diretório de execução — use os comandos dentro de `apps/odds-service`.

| Diretório | Variável | Uso |
|---|---|---|
| `data/` | DATA_DIR | Compatibilidade do modo file; PostgreSQL não duplica estado aqui |
| `evidence/raw/<provider>/` | RAW_CAPTURE_DIR | Raw opt-in, retenção padrão de 24h |
| `*-inbox/` | variáveis legadas | Somente importação/replay explícitos; nunca runtime normal |

O runtime PostgreSQL não cria inbox, `latest.json` ou NDJSON. `data/archive/` e evidências históricas existentes não são apagados. `dist/` é regenerável; o build o limpa. Snapshots SQL são append-only; EventRemoved não implica EventFinished. TTL padrão: 600 segundos (`MAX_AGE_SECONDS`).

Use somente uma instância escritora/coletora por diretório. Os locks não atravessam processos. A agenda em memória é reconstruída no restart; os snapshots persistidos são mantidos. Não há nova política de retenção de journals/capturas.

## Coleta manual e diagnóstico

Desative o scheduler da API antes de usar estes comandos em outro terminal:

```sh
npm run capture -- --existing --detail
npm run capture:betano -- --detail
npm run capture:superbet -- --detail
# Loops manuais legados ainda suportados:
npm run collect -- --existing --detail
npm run collect:betano -- --detail
```

`ESPORTS=cs2,lol,valorant`, `EVENT_ID` e `BETANO_EVENT_ID` filtram a coleta manual. Os CLIs usam o mesmo commit direto; `--save-raw` grava evidência temporária com retenção. Os loops manuais mantêm `CAPTURE_INTERVAL_SECONDS=180`, mínimo 60. O scheduler automático tem agenda própria.

## Estrutura e limites

`modules/bet365`, `modules/betano` e `modules/superbet` contêm protocolos, transportes, parsers e stores específicos. `collection` coordena a agenda; `snapshots` mantém o journal; `matching` recebe somente o domínio normalizado; `shared` contém domínio e infraestrutura neutra.

A coleta Betano cobre a aba popular. Bet365 captura as abas anunciadas e aceitas, excluindo Criar Aposta. Nem todo evento listado retorna detalhe utilizável; falhas preservam o estado anterior e aplicam backoff/circuit breaker. Intervalos são alvos, sujeitos à capacidade, fila e jitter. A API continua aplicando TTL. O encerramento fecha somente targets próprios e desconecta CDP; o contexto/Chrome pessoal não é fechado nem alterado.

- [Configuração e funcionamento do scheduler](docs/scheduler.md)
- [Campos e endpoints dos protocolos](docs/protocols.md)

A comparação aceita múltiplas fontes (cinco providers implementados) e conserva unmatched quando há ambiguidade; uma fonte sem dados frescos não impede a comparação das demais.

- [Chrome compartilhado](../../docs/SHARED_BROWSER.md) — ownership, locks, recovery, métricas e validação.

## Blaze — HTTP anônimo

`BLAZE_ENABLED=true` (default), `BLAZE_MAX_CONCURRENCY=1`. Execute `npm run capture:blaze -- --detail` para um ciclo ou use o scheduler normal. Não precisa de browser. API: `/providers/blaze/events`, `/providers/blaze/events/:id`, `/providers/blaze/health`. [Arquitetura, protocolo, testes e validação](../../docs/BLAZE.md).

## EstrelaBet — HTTP anônimo

`ESTRELABET_ENABLED=true`, `ESTRELABET_MAX_CONCURRENCY=1`. Captura: `npm run capture:estrelabet -- --detail`; scheduler: `npm start`. Rotas `/providers/estrelabet/events`, `/providers/estrelabet/events/:id`, `/providers/estrelabet/health`. [Protocolo e dois ciclos reais com PostgreSQL](../../docs/ESTRELABET.md).

## Monitor interno

`/monitor/*` expõe REST sobre PostgreSQL e `/monitor/stream` emite invalidações SSE. Configure `ODDS_MONITOR_ORIGIN` com a origin exata do frontend. [Contratos, configuração, testes e limitações](../../docs/MONITOR.md). A coleta não depende de clientes SSE conectados.
