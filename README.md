# NexusBet — odds-service

Backend de leitura de odds pré-jogo de eSports: coleta ofertas de Bet365, Betano e Superbet, normaliza mercados, compara eventos equivalentes e conserva histórico em PostgreSQL. O serviço NestJS vive em `apps/odds-service` e funciona sem frontend ou BFF.

O escopo atual cobre CS2, League of Legends e Valorant. Os mercados prioritários são vencedor da partida e vencedor dos mapas 1–3; o parser aceita mapas adicionais e preserva mercados desconhecidos. Não há apostas, carteira, pagamentos, cálculo de odds próprias ou coleta live.

`apps/odds-monitor` é uma aplicação React/Vite separada com dados mockados, ainda sem integração com este backend. Não é necessário instalá-la para trabalhar no odds-service. Não há workspace npm ou comando de instalação na raiz.

## Arquitetura

```text
Bet365 (Chrome) ─┐
Betano (Chrome) ─┼→ módulos de provider → validação / domínio normalizado
Superbet (HTTP) ─┘                         ↓
Collection: agenda → coleta → inbox → stores → PersistencePort
                                         ↓
                      PostgreSQL: entidades + snapshots + matching
                                         ↓
                             journal local → estado em memória
                                         ↓
                   API normalizada + comparação + consultas históricas
```

Stack: Node.js, TypeScript strict/ESM, NestJS 12, Prisma 7, PostgreSQL 16, Playwright Core/CDP e testes `node:test` via tsx. Os módulos e fluxos completos estão em [Architecture](docs/ARCHITECTURE.md).

## Primeira execução

Requisitos: Node **22.12+ na linha 22, ou 24+**, npm, Docker com Compose e Google Chrome instalado para Bet365/Betano. Prisma exige uma versão mais específica que o `>=22` do package.json. Use o lockfile versionado.

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

**Limite atual:** Chrome é headless por padrão, sem abrir páginas na tela nem fallback visível. Na última validação deste ambiente, Bet365 recebeu bloqueio 403/Cloudflare e Betano 403/splash sem feed utilizável. O transporte foi testado, mas a coleta real dessas duas fontes em headless não foi validada com sucesso. Superbet usa HTTP público. Não contorne proteções nem interprete testes com fixtures como garantia de disponibilidade externa.

## Configuração

ConfigModule lê `.env` dentro do diretório do serviço; ambiente do processo tem precedência. Caminhos relativos também dependem desse diretório.

| Grupo | Variáveis principais | Comportamento |
|---|---|---|
| Aplicação | `PORT`, `ESPORTS`, `MAX_AGE_SECONDS` | 3650, três modalidades, TTL 600s |
| Banco | `DATABASE_URL`, `PERSISTENCE_MODE`, `POSTGRES_*` | PostgreSQL explícito no exemplo; modo file disponível |
| Coleta | `COLLECTION_ENABLED`, `COLLECTION_LIST_INTERVAL_MS`, `DETAIL_INTERVAL_*` | Listagem 60s; detalhes adaptativos |
| Falhas | `PROVIDER_*`, `COLLECTION_BACKOFF_*`, `SHUTDOWN_GRACE_MS` | Timeout, cooldown e drenagem |
| Browser | `HEADLESS`, `CDP_URL`, `CHROME_DEBUG_PORT_FILE` | Headless true; CDP externo apenas no diagnóstico visível |
| Arquivos/testes | `DATA_DIR`, `*_INBOX_DIR`, `BROWSER_TESTS`, `TEST_DATABASE_URL` | Journal, ingestão e testes opcionais |

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

Somente GET, em `127.0.0.1`; não há autenticação de usuário nem API pública pronta para exposição externa.

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

Listagem tem prioridade sobre detalhes, e os intervalos não garantem atualização de todo o catálogo dentro do TTL. Matching é conservador e não produz consenso de odds. Journal de arquivos e checkpoints de compatibilidade continuam presentes. Não há retenção automática, coordenação distribuída, paginação completa ou integração Sentry/Railway configurada neste repositório.

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
