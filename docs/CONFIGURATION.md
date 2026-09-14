# Referência de configuração

[Índice](../README.md#documentation) · [.env.example](../apps/odds-service/.env.example) · Fontes: [configuration.ts](../apps/odds-service/src/config/configuration.ts), [collection.configuration.ts](../apps/odds-service/src/config/collection.configuration.ts).

ConfigModule lê .env e o ambiente do processo tem precedência. Execute no diretório do serviço; paths relativos usam cwd. Prisma CLI/testes SQL também carregam dotenv. Credentials.txt não é configuração. Valores abaixo são defaults do código, exceto placeholders/decisões do exemplo explicitamente indicados. Variáveis opcionais não precisam ser definidas; não use string vazia como substituto de número.

## Application

| Variável | Default / exemplo | Uso |
|---|---|---|
| `PORT` | `3650` | Porta; bind fixo 127.0.0.1; mínimo configurável 0 |
| `ESPORTS` | `cs2,lol,valorant` | Lista separada por vírgulas sem espaços |
| `MAX_AGE_SECONDS` | `600` | TTL em segundos, mínimo 1 |
| `DATA_DIR` | `data` | Diretório dos estados/journals |

## Database

| Variável | Default / exemplo | Uso |
|---|---|---|
| `POSTGRES_DB` | `odds_service` | Compose: nome do banco |
| `POSTGRES_USER` | `odds` | Compose: usuário local de exemplo |
| `POSTGRES_PASSWORD` | `local_development_only` | Placeholder local; Compose exige senha; nunca usar senha real versionada |
| `POSTGRES_PORT` | `5433` | Compose: porta local; atualize DATABASE_URL se mudar |
| `DATABASE_URL` | `postgresql://odds:local_development_only@127.0.0.1:5433/odds_service` | URL local de exemplo; obrigatória em modo postgres |
| `PERSISTENCE_MODE` | `postgres` | Exemplo postgres; default do código: postgres se URL definida, senão file |

## Collection

| Variável | Default / exemplo | Uso |
|---|---|---|
| `COLLECTION_ENABLED` | `false` | Exemplo seguro false; default do código true; aceita true/false/1/0 |
| `COLLECTION_STARTUP_DELAY_MS` | `3000` | Espera inicial, mínimo 0 |
| `COLLECTION_TICK_MS` | `1000` | Tick em memória, mínimo 100; não é polling remoto |
| `COLLECTION_LIST_INTERVAL_MS` | `60000` | Listagem por provider; mínimo 30000 |
| `DETAIL_INTERVAL_GT_24H_MS` | `600000` | Detalhe >24h; mínimo 30000 |
| `DETAIL_INTERVAL_6H_24H_MS` | `300000` | Detalhe 6h–24h inclusivo; mínimo 30000 |
| `DETAIL_INTERVAL_1H_6H_MS` | `120000` | Detalhe >=1h e <6h; mínimo 30000 |
| `DETAIL_INTERVAL_LT_1H_MS` | `60000` | Detalhe >0 e <1h; mínimo 30000 |
| `COLLECTION_JITTER_MS` | `5000` | Mínimo 0; variação efetiva limitada a menos de 10000ms |
| `PROVIDER_LIST_TIMEOUT_MS` | `60000` | Timeout listagem; mínimo 1 |
| `PROVIDER_DETAIL_TIMEOUT_MS` | `60000` | Timeout detalhe; mínimo 1 |
| `PROVIDER_FAILURE_THRESHOLD` | `5` | Falhas consecutivas para cooldown; mínimo 1 |
| `PROVIDER_COOLDOWN_MS` | `300000` | Pausa; mínimo 30000 |
| `COLLECTION_BACKOFF_FIRST_MS` | `30000` | Primeira falha; mínimo 30000 |
| `COLLECTION_BACKOFF_SECOND_MS` | `60000` | Segunda falha; mínimo 30000 |
| `COLLECTION_BACKOFF_THIRD_MS` | `120000` | Terceira falha; mínimo 30000 |
| `COLLECTION_BACKOFF_MAX_MS` | `300000` | Quarta falha e seguintes; mínimo 30000 |
| `SHUTDOWN_GRACE_MS` | `30000` | Espera antes de abort; commits ainda são drenados; mínimo 0 |
| `INBOX_SCAN_INTERVAL_MS` | `5000` | Scanner local; mínimo 1 |
| `INBOX_SCAN_ENABLED` | `1` | Somente 0 desabilita timer; false NÃO desabilita |
| `INBOX_INGEST_ENABLED` | `1` | Somente 0 desabilita ingestão; false NÃO desabilita |
| `CAPTURE_INTERVAL_SECONDS` | `180` | Loop CLI legado, mínimo 60; não altera scheduler |

## Bet365

| Variável | Default / exemplo | Uso |
|---|---|---|
| `BET365_MAX_CONCURRENCY` | `1` | Mínimo 1; efetivamente limitado a 1 |
| `INBOX_DIR` | `inbox` | Listagens Bet365 |
| `DETAIL_INBOX_DIR` | `detail-inbox` | Detalhes Bet365 |
| `CAPTURE_DIR` | `captures` | Capturas de diagnóstico Bet365; Superbet publica em SUPERBET_INBOX_DIR |

## Betano

| Variável | Default / exemplo | Uso |
|---|---|---|
| `BETANO_MAX_CONCURRENCY` | `1` | Mínimo 1; efetivamente limitado a 1 |
| `BETANO_INBOX_DIR` | `betano-inbox` | Rodadas Betano |
| `BETANO_CAPTURE_DIR` | `captures/betano` | Capturas Betano |

## Superbet

| Variável | Default / exemplo | Uso |
|---|---|---|
| `SUPERBET_MAX_CONCURRENCY` | `1` | Mínimo 1; efetivamente limitado a 1 |
| `SUPERBET_INBOX_DIR` | `superbet-inbox` | Rodadas Superbet |

## Browser/CDP

| Variável | Default / exemplo | Uso |
|---|---|---|
| `HEADLESS` | `true` | Aceita true/false/1/0; modo true ignora CDP externo; sem fallback visível |

## Testing

| Variável | Default / exemplo | Uso |
|---|---|---|
| `BROWSER_TESTS` | `0` | Somente 1 habilita testes opcionais de Chrome com feeds locais |

## Opcionais e compatibilidade

| Variável | Exemplo, não default | Uso |
|---|---|---|
| `POLLING_ENABLED` | `0` | Compatibilidade: fallback de COLLECTION_ENABLED somente se esta estiver ausente; prefira COLLECTION_ENABLED |
| `EVENT_ID` | `id-externo` | Seleção manual Bet365; restrinja ESPORTS |
| `BETANO_EVENT_ID` | `id-externo` | Seleção manual Betano; restrinja ESPORTS |
| `CDP_URL` | `http://127.0.0.1:9222` | Endpoint CDP autorizado, somente diagnóstico HEADLESS=false |
| `CHROME_DEBUG_PORT_FILE` | `/caminho/para/DevToolsActivePort` | Arquivo do Chrome externo, somente diagnóstico visível |
| `TEST_DATABASE_URL` | `postgresql://odds:local_development_only@127.0.0.1:5433/odds_service_test` | Banco descartável *_test; suíte SQL TRUNCA tabelas |

## Detalhes operacionais

- Variáveis de collection numéricas exigem inteiros seguros e mínimos indicados. O config geral valida finitude/mínimo, sem prometer a mesma validação de inteiros.
- CODE default COLLECTION_ENABLED=true contrasta deliberadamente com exemplo false. Se COLLECTION_ENABLED não existir, POLLING_ENABLED é fallback; não configure ambas para controlar loops concorrentes.
- HEADLESS=true não usa CDP_URL, --existing ou perfil pessoal. Diagnóstico HEADLESS=false pode exigir autorização de Chrome nativo. Sem CHROME_DEBUG_PORT_FILE, endpoint.ts procura o arquivo padrão do Chrome no ambiente suportado; isso não provisiona Chrome remotamente.
- INBOX_SCAN_ENABLED=0 para o timer não impede o refresh inicial; INBOX_INGEST_ENABLED=0 controla ingestão. Não troque esses flags por false: o código legado só reconhece 0 para desabilitar.
- PERSISTENCE_MODE=file não sincroniza automaticamente com PostgreSQL. Modo postgres com URL inválida falha, sem fallback silencioso.
- Alterar POSTGRES_USER/PASSWORD/DB no Compose não recria usuários de um volume já inicializado. Não apague o volume para solucionar isso sem backup e plano de migração.
- PROVIDER_* timeouts não são prazo máximo absoluto de commit/shutdown. A drenagem protege histórico.
- Não há SUPERBET_EVENT_ID nem URL remota configurável por env no cliente Superbet atual; não invente variáveis que o código não lê.
- O app separado odds-monitor lê DISABLE_HMR no vite.config.ts (`true` desliga HMR/watch). Essa variável não pertence ao backend nem é necessária para executá-lo.

