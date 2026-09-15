# Runtime atual Bet365/Betano

- `BROWSER_RUNTIME`: `local-cdp` ou `disabled` (default disabled).
- `BET365_ENABLED`, `BETANO_ENABLED`: booleanos; true por default somente com local-cdp explícito fora de NODE_ENV=production. Configure false em Railway.
- `CDP_ENDPOINT`: WebSocket local opcional, alias prioritário a CDP_URL. Ausente: CHROME_DEBUG_PORT_FILE/DevToolsActivePort do Chrome Mac.
- `CDP_RECONNECT_COOLDOWN_MS`: 300000, mínimo 60000.

[Local CDP](LOCAL_CDP.md) define suporte/ownership. BROWSER_MODE/HEADLESS/profile/flags de Chrome próprio abaixo são legado de testes e não alteram a estratégia desses providers.

# Referência de configuração

[Índice](../README.md#documentation) · [.env.example](../apps/odds-service/.env.example) · Fontes: [configuration.ts](../apps/odds-service/src/config/configuration.ts), [collection.configuration.ts](../apps/odds-service/src/config/collection.configuration.ts).

ConfigModule lê .env e o ambiente do processo tem precedência. Execute no diretório do serviço; paths relativos usam cwd. Prisma CLI/testes SQL também carregam dotenv. Credentials.txt não é configuração. Valores abaixo são defaults do código, exceto placeholders/decisões do exemplo explicitamente indicados. Variáveis opcionais não precisam ser definidas; não use string vazia como substituto de número.

## Application

| Variável | Default / exemplo | Uso |
|---|---|---|
| `PORT` | `3650` | Porta; mínimo configurável 0 |
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
| `INGESTION_MODE` | `direct` | Único modo de runtime aceito |
| `RAW_CAPTURE_ENABLED` | `false` | Salva raw somente para diagnóstico |
| `RAW_CAPTURE_RETENTION_HOURS` | `24` | Retenção automática dos raws habilitados |
| `RAW_CAPTURE_DIR` | `evidence/raw` | Raiz das evidências temporárias por provider |
| `LEGACY_INBOX_IMPORT_ENABLED` | `false` | Reserva explícita para ferramentas legadas; não ativa scanner |
| `CAPTURE_INTERVAL_SECONDS` | `180` | Loop CLI legado, mínimo 60; não altera scheduler |

## Bet365

| Variável | Default / exemplo | Uso |
|---|---|---|
| `BET365_MAX_CONCURRENCY` | `1` | Mínimo 1; efetivamente limitado a 1 |
| `INBOX_DIR` | `inbox` | Caminho legado usado apenas pelo importador |
| `DETAIL_INBOX_DIR` | `detail-inbox` | Caminho legado usado apenas pelo importador |
| `CAPTURE_DIR` | `captures` | Compatibilidade de configuração; raw novo usa RAW_CAPTURE_DIR |

## Betano

| Variável | Default / exemplo | Uso |
|---|---|---|
| `BETANO_MAX_CONCURRENCY` | `1` | Mínimo 1; efetivamente limitado a 1 |
| `BETANO_INBOX_DIR` | `betano-inbox` | Importação legada |
| `BETANO_CAPTURE_DIR` | `captures/betano` | Compatibilidade; raw novo usa RAW_CAPTURE_DIR |

## Superbet

| Variável | Default / exemplo | Uso |
|---|---|---|
| `SUPERBET_MAX_CONCURRENCY` | `1` | Mínimo 1; efetivamente limitado a 1 |
| `SUPERBET_INBOX_DIR` | `superbet-inbox` | Importação legada |

## Browser/CDP

| Variável | Default | Uso |
|---|---|---|
| BROWSER_MODE | headed | Precede HEADLESS; runtime de produção exige headed |
| CHROME_CHANNEL | chrome | Somente Google Chrome Stable |
| BROWSER_PROFILE_DIR | data/chrome-profile | Diretório do perfil compartilhado; sem subdiretórios por provider |
| BROWSER_PERSISTENT | true | true/false/1/0; false cria perfil temporário descartável |
| BROWSER_LOCALE | pt-BR | Locale do contexto, sem User-Agent inventado |
| BROWSER_TIMEZONE | America/Sao_Paulo | Timezone validado por Intl |
| BROWSER_VIEWPORT_WIDTH | 1440 | Inteiro 320–7680 |
| BROWSER_VIEWPORT_HEIGHT | 900 | Inteiro 320–7680; screen igual ao viewport |
| BROWSER_EVIDENCE_DIR | evidence/browser | Metadados sanitizados e screenshot no fechamento |
| HEADLESS | false | Compatibilidade: seleciona modo somente quando BROWSER_MODE não existe |

Light colorScheme, deviceScaleFactor=1 e serviceWorkers=allow ficam centralizados em launchOptions. Não há bloqueio de recursos nem interceptação para modificar respostas. Perfil persistente contém cookies técnicos legítimos: é privado, ignorado pelo Git e não é exportado como evidência.

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
| `CDP_URL` | `http://127.0.0.1:9222` | Legado de transporte externo; não usado pelos clients gerenciados atuais |
| `CHROME_DEBUG_PORT_FILE` | `/caminho/para/DevToolsActivePort` | Arquivo do Chrome externo; somente utilitário legado |
| `TEST_DATABASE_URL` | `postgresql://odds:local_development_only@127.0.0.1:5433/odds_service_test` | Banco descartável *_test; suíte SQL TRUNCA tabelas |

## Detalhes operacionais

- Variáveis de collection numéricas exigem inteiros seguros e mínimos indicados. O config geral valida finitude/mínimo, sem prometer a mesma validação de inteiros.
- CODE default COLLECTION_ENABLED=true contrasta deliberadamente com exemplo false. Se COLLECTION_ENABLED não existir, POLLING_ENABLED é fallback; não configure ambas para controlar loops concorrentes.
- Os clients atuais usam Chrome próprio em ambos os modos. CDP_URL/--existing/reuseProfile não selecionam o browser pessoal. HEADLESS=false é fallback para headed somente sem BROWSER_MODE; prefira BROWSER_MODE=headed. Utilitários de CDP externo permanecem para compatibilidade/testes, fora desse fluxo.
- `refresh` inicial restaura estado do PostgreSQL; não observa diretórios. Variáveis `INBOX_*` antigas não ativam ingestão no runtime.
- PERSISTENCE_MODE=file não sincroniza automaticamente com PostgreSQL. Modo postgres com URL inválida falha, sem fallback silencioso.
- Alterar POSTGRES_USER/PASSWORD/DB no Compose não recria usuários de um volume já inicializado. Não apague o volume para solucionar isso sem backup e plano de migração.
- PROVIDER_* timeouts não são prazo máximo absoluto de commit/shutdown. A drenagem protege histórico.
- Não há SUPERBET_EVENT_ID nem URL remota configurável por env no cliente Superbet atual; não invente variáveis que o código não lê.
- O app separado odds-monitor lê DISABLE_HMR no vite.config.ts (`true` desliga HMR/watch). Essa variável não pertence ao backend nem é necessária para executá-lo.


## Runtime Linux/Xvfb

`HOST` default local 127.0.0.1; imagem define 0.0.0.0. `DISPLAY` default :99 no entrypoint. Com `BROWSER_RUNTIME=disabled`, o entrypoint não inicia Xvfb. Quando habilitado, o Xvfb usa as mesmas BROWSER_VIEWPORT_WIDTH/HEIGHT do Chrome, 24 bits, sem TCP. `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=90` e `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=0` são variáveis da plataforma. Volume `/service/data`; detalhes em [produção](PRODUCTION_RUNTIME.md).

O diagnóstico temporário de memória é habilitado por `MEMORY_DIAGNOSTICS_ENABLED=true`; `MEMORY_DIAGNOSTICS_INTERVAL_MS` (default 300000) e `MEMORY_DIAGNOSTICS_STARTUP_DELAY_MS` (default 30000) controlam as amostras. Heap snapshots opcionais no volume usam `MEMORY_DIAGNOSTICS_HEAP_SNAPSHOTS=true` e `MEMORY_DIAGNOSTICS_HEAP_SNAPSHOT_AFTER_MS` (default 1800000). Mantenha desabilitado fora de uma investigação, pois snapshots pausam o processo e ocupam disco.

## Chrome compartilhado

- `BROWSER_SHARED_INSTANCE=true`, `BROWSER_SHARED_CONTEXT=true`, `PROVIDER_MAIN_TAB=true`: somente true/1 são suportados; false falha na configuração, sem fallback para múltiplos browsers.
- `PROVIDER_DETAIL_TAB_MAX=1`: 0 ou 1. Os providers atuais não precisam da tab extra; quando usada via gerenciador, fecha ao concluir/falhar.
- `BROWSER_PROFILE_DIR=data/chrome-profile`: caminho do próprio perfil, sem sufixo do provider. Imagem: `/service/data/chrome-profile`, no volume persistente.
- Concorrência continua 1 por provider, além do mutex de page. Blaze e EstrelaBet usam HTTP independente, com flags ENABLED e limites próprios no scheduler.

Veja [SHARED_BROWSER](SHARED_BROWSER.md).

O BrowserManagerService exige persistência habilitada; BROWSER_PERSISTENT=false não é suportado no fluxo compartilhado. Utilitários legados de teste ainda podem usar contexto temporário isolado.

## Blaze HTTP

`BLAZE_ENABLED=true` habilita coleta; `BLAZE_MAX_CONCURRENCY=1` usa limite global por provider. Utiliza ingestão direta e timeouts/intervalos globais, sem cookies/login/browser. [Protocolo](BLAZE.md).

## EstrelaBet HTTP

`ESTRELABET_ENABLED=true`, `ESTRELABET_MAX_CONCURRENCY=1`. Usa ingestão direta, intervalos e timeouts globais, sem cookies ou browser. [Protocolo e operação](ESTRELABET.md).
