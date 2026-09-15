# NexusBet — odds-service

Backend de leitura de odds pré-jogo de eSports: coleta ofertas de Bet365, Betano, Superbet, Blaze e EstrelaBet, normaliza mercados, compara eventos equivalentes e conserva histórico em PostgreSQL. O serviço NestJS vive em `apps/odds-service` e funciona sem frontend ou BFF.

O escopo atual cobre CS2, League of Legends e Valorant. Os mercados prioritários são vencedor da partida e vencedor dos mapas 1–3; o parser aceita mapas adicionais e preserva mercados desconhecidos. Não há apostas, carteira, pagamentos, cálculo de odds próprias ou coleta live.

`apps/odds-monitor` é o frontend interno React/Vite conectado ao backend por REST GET + SSE; usa somente dados reais persistidos. Guia de execução, API, invalidação e testes: [Monitor](docs/MONITOR.md). Não é necessário instalá-la para trabalhar no odds-service. Não há workspace npm ou comando de instalação na raiz.

## Runtime suportado: desenvolvimento local

Bet365 e Betano usam exclusivamente **`BROWSER_RUNTIME=local-cdp` no macOS**, conectando ao Chrome headed existente e gerenciando somente suas próprias tabs. **Linux/Xvfb e headless não são suportados** para esses providers. Em Railway: `BET365_ENABLED=false`, `BETANO_ENABLED=false`, `BROWSER_RUNTIME=disabled`. Superbet, Blaze e EstrelaBet mantêm HTTP independente.

Preparação do Chrome, flags, ownership, indisponibilidade e shutdown: [Local CDP](docs/LOCAL_CDP.md).

## Arquitetura

```text
Bet365 (Chrome) ─┐
Betano (Chrome) ─┼→ módulos de provider → validação / domínio normalizado
Superbet (HTTP) ─┤
Blaze (HTTP) ────┤
EstrelaBet (HTTP)┘                         ↓
Collection: agenda → coleta/parse → commit direto → PersistencePort
                                         ↓
                      PostgreSQL: entidades + snapshots + matching
                                         ↓
                              estado em memória pós-commit
                                         ↓
                   API normalizada + comparação + consultas históricas
```

Stack: Node.js, TypeScript strict/ESM, NestJS 12, Prisma 7, PostgreSQL 16, Playwright Core/CDP e testes `node:test` via tsx. Os módulos e fluxos completos estão em [Architecture](docs/ARCHITECTURE.md).

## Primeira execução

Requisitos: Node **22.12+ na linha 22, ou 24+**, npm, Docker com Compose e macOS e Google Chrome headed existente com CDP habilitado para Bet365/Betano. Prisma exige uma versão mais específica que o `>=22` do package.json. Use o lockfile versionado.

```sh
cd apps/odds-service
npm ci
# Somente se .env ainda não existir:
cp .env.example .env
# Revise os placeholders locais de PostgreSQL no .env.
docker compose up -d
npm run db:migrate
npm run db:seed
npm run db:status
npm run build
npm start
```

Em outro terminal:

```sh
curl http://127.0.0.1:3650/health
curl http://127.0.0.1:3650/providers
```

O exemplo desliga a coleta (`COLLECTION_ENABLED=false`), permitindo validar banco/API sem acessar sites. Um banco novo não contém eventos: respostas vazias nas consultas SQL e 503 nas leituras normalizadas sem captura são esperados. `db:seed` insere apenas providers. Aplique migrations antes de iniciar: o startup verifica sua integridade, mas não aplica DDL.

Para coleta contínua, pare a instância anterior e execute `COLLECTION_ENABLED=true npm start`. Para executar o build, use `npm run start:prod`. Não há script `dev`/watch do servidor: `npm start` executa TypeScript, sem recarga automática. Encerre com Ctrl+C e aguarde a drenagem. Execute uma instância escritora/coletora por instalação.

**Runtime atual:** Bet365/Betano somente via Chrome existente no Mac (`local-cdp`). Em Railway/Linux ambos ficam desabilitados; Superbet, Blaze e EstrelaBet mantêm HTTP. Veja [Local CDP](docs/LOCAL_CDP.md).

## Configuração

ConfigModule lê `.env` dentro do diretório do serviço; ambiente do processo tem precedência. Caminhos relativos também dependem desse diretório.

| Grupo | Variáveis principais | Comportamento |
|---|---|---|
| Aplicação | `PORT`, `ESPORTS`, `MAX_AGE_SECONDS` | 3650, três modalidades, TTL 600s |
| Banco | `DATABASE_URL`, `PERSISTENCE_MODE`, `POSTGRES_*` | PostgreSQL explícito no exemplo; modo file disponível |
| Coleta | `COLLECTION_ENABLED`, `COLLECTION_LIST_INTERVAL_MS`, `DETAIL_INTERVAL_*` | Listagem 60s; detalhes adaptativos |
| Falhas | `PROVIDER_*`, `COLLECTION_BACKOFF_*`, `SHUTDOWN_GRACE_MS` | Timeout, cooldown e drenagem |
| Browser | `BROWSER_MODE`, `BROWSER_PROFILE_DIR`, `BROWSER_LOCALE` | Chrome próprio headed, Xvfb no container |
| Ingestão/debug | `INGESTION_MODE`, `RAW_CAPTURE_ENABLED`, `RAW_CAPTURE_RETENTION_HOURS` | Direta; raw desligado por padrão e com retenção |

Referência completa de todas as variáveis e seus defaults: [Configuration](docs/CONFIGURATION.md) e [.env.example](apps/odds-service/.env.example). Nunca copie segredos para exemplos, fixtures ou documentação.

## Testes e banco

Dentro de `apps/odds-service`:

```sh
npm run build
npm run typecheck
npm run format:check
npm test
# Opcional: Chrome invisível com feeds locais, sem consultar bookmakers:
BROWSER_TESTS=1 npm test
```

Não há ESLint/script `lint` no backend. Prettier verifica formatação, não substitui análise estática. [Testing](docs/TESTING.md) lista todos os scripts, testes SQL e critérios de regressão.

Os hooks versionados em `.githooks/` são instalados por `npm ci`/`npm install` em qualquer um dos apps. O `pre-commit` executa formatação e typecheck; o `pre-push` executa builds e suítes offline dos dois apps. A integração PostgreSQL também roda no `pre-push` quando `TEST_DATABASE_URL` aponta para um banco descartável terminado em `_test`.

Prisma: `db:generate` gera o cliente, `db:migrate` aplica migrations, `db:status` consulta pendências e `db:seed` é idempotente. A criação de migrations de desenvolvimento e a importação opcional estão em [Data model](docs/DATA_MODEL.md) e no [guia PostgreSQL existente](apps/odds-service/docs/postgres.md). Não há comando de reset seguro automático; testes SQL exigem banco descartável separado.

## Estrutura

```text
AGENTS.md                    instruções de trabalho
apps/
  odds-service/
    src/{main.ts,app.module.ts,bootstrap.ts}
    src/config/
    src/modules/{bet365,betano,superbet,collection,matching,snapshots}
    src/modules/{database,persistence,health}
    src/shared/{domain,interfaces,browser,errors,types,utils}
    prisma/{schema.prisma,migrations/}
    docs/                    guias existentes e protocolo detalhado
  odds-monitor/              aplicação separada, dados mockados
docs/                        documentação transversal e onboarding
```

Providers têm parsers, fixtures e testes próprios. Bet365 interpreta protocolo textual e rotas de abas; Betano agrega competições JSON e captura detalhes populares; Superbet interpreta JSON público de listagem/detalhe. Veja [Providers](docs/PROVIDERS.md).

O banco separa providers, eventos canônicos, versões por provider, decisões de matching, mercados, seleções, snapshots e issues. Tabelas auxiliares preservam scopes e checkpoints para reinício. **EventRemoved não significa EventFinished.**

## API atual

Somente GET; bind local `127.0.0.1`, container `0.0.0.0` via `HOST`; não há autenticação de usuário nem API pública pronta para exposição externa.

| Rota | Uso |
|---|---|
| `/health` | Estado operacional; HTTP 200 sozinho não comprova dados frescos |
| `/providers/{bet365,betano,superbet}/events` e `/events/:id` sob esse prefixo | Listagem/detalhe normalizados; ID externo; `?esport=cs2` opcional |
| `/providers/{provider}/health` | Estado do store/provider |
| `/comparisons`, `/matching/unmatched` | Matching das listagens frescas disponíveis |
| `/matches`, `/matches/:id`, `/provenance` | Compatibilidade histórica Bet365 |
| `/providers/{provider}/matches` e `/matches/:id` sob esse prefixo | Aliases de events |
| `/providers`, `/provider-events?provider=superbet` | Consultas SQL de providers/eventos brutos normalizados |
| `/events`, `/events/:uuid` | Canônicos persistentes com relações e últimas odds |
| `/issues?status=open` | Issues persistentes |
| `/selections/:uuid/odds-history?before=ISO` | Histórico por UUID interno |

Rotas normalizadas aplicam TTL; rotas SQL são históricas e exigem inspecionar timestamps/listed. Números decimais SQL serializam como strings; odds das rotas normalizadas continuam numéricas. Contratos, limites e diagnóstico: [Operations](docs/OPERATIONS.md).

## Limitações e troubleshooting

Listagem tem prioridade sobre detalhes, e os intervalos não garantem atualização de todo o catálogo dentro do TTL. Matching é conservador e não produz consenso de odds. Journal de arquivos e checkpoints de compatibilidade continuam presentes. Não há retenção automática, coordenação distribuída, paginação completa ou integração Sentry. Dockerfile e guia de deploy preparam o runtime, sem comprovar deploy remoto.

Se não houver dados, consulte `/health`, logs de Collection, timestamps e cobertura do provider antes de alterar parsers ou TTL. Para migrations pendentes use `db:status`; para muitos unmatched revise nomes/competição/horário. O roteiro completo está em [Operations](docs/OPERATIONS.md).

## Documentation

- [AGENTS.md](AGENTS.md) — regras para agentes e desenvolvedores.
- [Architecture](docs/ARCHITECTURE.md) — módulos, contratos e fluxos.
- [Data model](docs/DATA_MODEL.md) — schema, constraints, índices e lifecycle.
- [Providers](docs/PROVIDERS.md) — transportes, parsers e novos providers.
- [Matching](docs/MATCHING.md) — aliases, critérios, ambiguidades e persistência.
- [Collection](docs/COLLECTION.md) — scheduler, locks, falhas e shutdown.
- [Odds history](docs/ODDS_HISTORY.md) — snapshots, scopes e journal.
- [Operations](docs/OPERATIONS.md) — manutenção e diagnóstico.
- [Testing](docs/TESTING.md) — comandos e validação segura.
- [Decisions](docs/DECISIONS.md) — decisões, divergências e limites atuais.
- [Configuration](docs/CONFIGURATION.md) — referência completa de ambiente.
- [README do serviço](apps/odds-service/README.md) — operação local e guias técnicos anteriores.

- [Diagnóstico headed/headless](docs/HEADLESS_DIAGNOSTICS.md) — configuração, comparação real, Linux e limites encontrados.

- [Produção Linux/Xvfb](docs/PRODUCTION_RUNTIME.md) — Docker, Railway, volume, shutdown e validação real.

- [Chrome compartilhado](docs/SHARED_BROWSER.md) — ownership, locks, recovery, métricas e validação.

### Blaze

Blaze está integrada por HTTP público, sem Chrome/login, com CS2/LoL/Valorant, mercados de partida/mapas, snapshots e PostgreSQL. Veja [protocolo, validação e limites](docs/BLAZE.md).

### EstrelaBet

Quinto provider, HTTP Altenar anônimo para listagens paginadas e detalhes. Sem browser/login; integrado a scheduler, snapshots, matching e PostgreSQL. [Protocolo, validação real e operação](docs/ESTRELABET.md).
