# Odds Service

Backend NestJS somente leitura para odds pré-jogo de CS2, LoL e Valorant, com providers independentes bet365, Betano e Superbet, scheduler adaptativo, snapshots persistentes e matching conservador. Usa PostgreSQL com Prisma para persistência e mantém os journals locais durante a migração. Não depende de frontend ou BFF.

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

O padrão é `HEADLESS=true`: Bet365 e Betano usam processos Chrome invisíveis, isolados e encerrados pelo serviço. Não é necessário abrir seu Chrome nem autorizar CDP pessoal. `CDP_URL`, `--existing` e o perfil pessoal não são usados nesse modo; não há fallback para janelas visíveis. Chrome precisa estar instalado. Superbet continua usando HTTP público.

Na validação deste ambiente, a sessão headless recebeu bloqueio HTTP 403 na Bet365 (Cloudflare) e na Betano (splash sem conteúdo utilizável). Portanto o transporte invisível funciona, mas a coleta real dessas duas fontes em headless não foi validada com sucesso. Falhas seguem backoff/circuit breaker e preservam snapshots até o TTL, sem contorno de proteção.

Somente para diagnóstico visível explícito, `HEADLESS=false` restaura o transporte anterior: habilite a depuração remota nativa em `chrome://inspect/#remote-debugging`. `CHROME_DEBUG_PORT_FILE` ou `CDP_URL` configuram outro endpoint local autorizado.

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
| `data/` | DATA_DIR | Estados e journals persistentes |
| `inbox/` | INBOX_DIR | Listagens bet365 |
| `detail-inbox/` | DETAIL_INBOX_DIR | Detalhes bet365 |
| `betano-inbox/` | BETANO_INBOX_DIR | Rodadas Betano |
| `superbet-inbox/` | SUPERBET_INBOX_DIR | Rodadas HTTP Superbet |
| `captures/` | CAPTURE_DIR | Capturas bet365 para diagnóstico |
| `captures/betano/` | BETANO_CAPTURE_DIR | Capturas Betano para diagnóstico |

`data/` e as inboxes contêm dados operacionais, não código. `data/archive/` conserva journals históricos retirados das capturas de investigação. `captures/` e `dist/` são regeneráveis; o build limpa `dist/` antes de compilar. Esses diretórios são ignorados pelo Git. Snapshots/journals são append-only; EventRemoved não implica EventFinished. TTL padrão: 600 segundos (`MAX_AGE_SECONDS`). O scanner de inbox roda a cada 5000 ms (`INBOX_SCAN_INTERVAL_MS`); `INBOX_SCAN_ENABLED=0` desliga seu timer e `INBOX_INGEST_ENABLED=0` desliga a ingestão.

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

`ESPORTS=cs2,lol,valorant`, `EVENT_ID` e `BETANO_EVENT_ID` filtram a coleta manual. Os CLIs não escrevem diretamente nos journals: publicam nos inboxes para a API ingerir. Os loops manuais mantêm `CAPTURE_INTERVAL_SECONDS=180`, mínimo 60. O scheduler automático tem agenda própria.

## Estrutura e limites

`modules/bet365`, `modules/betano` e `modules/superbet` contêm protocolos, transportes, parsers e stores específicos. `collection` coordena a agenda; `snapshots` mantém o journal; `matching` recebe somente o domínio normalizado; `shared` contém domínio e infraestrutura neutra.

A coleta Betano cobre a aba popular. Bet365 captura as abas anunciadas e aceitas, excluindo Criar Aposta. Nem todo evento listado retorna detalhe utilizável; falhas preservam o estado anterior e aplicam backoff/circuit breaker. Intervalos são alvos, sujeitos à capacidade, fila e jitter. A API continua aplicando TTL. No headless, o encerramento fecha o browser e perfil temporário próprios. No modo de Chrome externo, fecha apenas abas próprias; contextos anônimos vazios ficam para o ciclo de vida do Chrome, pois sua destruição explícita já causou crashes na instalação testada.

- [Configuração e funcionamento do scheduler](docs/scheduler.md)
- [Campos e endpoints dos protocolos](docs/protocols.md)

A comparação aceita duas ou três fontes e conserva unmatched quando há ambiguidade; uma fonte sem dados frescos não impede a comparação das demais.
