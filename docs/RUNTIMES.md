# Server e collector-agent

O mesmo `apps/odds-service` produz dois entrypoints. **Todos os cinco coletores rodam no PC dedicado. Railway recebe exclusivamente HTTPS.** Não existe conexão do agent ao PostgreSQL.

| Processo | Entrada | Responsabilidades |
| --- | --- | --- |
| server | `src/main.ts`, `npm run start:server`, `node dist/main.js` | Nest API, monitor/SSE, ingestion, PostgreSQL, matching, issues e snapshots |
| collector-agent | `src/collector-agent.main.ts`, `npm run start:collector-agent`, `node dist/collector-agent.main.js` | Scheduler existente e os cinco providers, parsers, validação, outbox e heartbeat |

O server não importa módulos de coletores nem SchedulerService. Os adapters recebidos não têm transporte. Os aliases `/providers/:provider/matches` e `/matches` permanecem; `/provenance` identifica a ingestão e a ausência deliberada de raw na versão 1. O Dockerfile não instala Chrome ou Xvfb. O agent inicia `createApplicationContext`, sem listener HTTP, e substitui PersistencePort pelo envio remoto; não carrega DatabaseModule, migrations, matching global ou MonitorModule. Os stores conservam apenas estado operacional em memória; seus journals/checkpoints não são gravados no PC. O journal/checkpoint legado SQL permanece no server.

## Configuração

Server (Railway):

```dotenv
ODDS_RUNTIME=server
COLLECTION_ENABLED=false
PERSISTENCE_MODE=postgres
DATABASE_URL=postgresql://...
ODDS_INGESTION_TOKEN=<segredo-aleatorio-de-pelo-menos-32-caracteres>
BROWSER_RUNTIME=disabled
RAW_CAPTURE_ENABLED=false
HOST=0.0.0.0
```

Mesmo se COLLECTION_ENABLED estiver incorretamente true, server não inicia coleta. Não use flags BET365_ENABLED/BETANO_ENABLED para excluir dados recebidos: os cinco providers são esperados no monitor, respeitando `providers.enabled` no banco. Aplique migrations antes do startup (`npm run db:migrate`); Railway já tem esse pre-deploy configurado. Execute uma instância server para manter projeções em memória coerentes; não há distribuição de notificações SSE entre réplicas.

Agent: copie [agent.env.example](../apps/odds-service/runtime/agent/agent.env.example) para um arquivo local privado, **fora do checkout**. Não configure DATABASE_URL. `COLLECT_*` controla os cinco providers; os intervalos e locks são os mesmos de [Collection](COLLECTION.md). HTTP só é permitido para ODDS_SERVER_URL em loopback durante testes; operação remota exige HTTPS. URLs com credenciais, query, fragment ou caminho são rejeitadas. O token deve ser igual nos dois processos e nunca aparece nos logs.

## Protocolo e entrega

`POST /internal/ingestion/:provider`, com `Authorization: Bearer <ODDS_INGESTION_TOKEN>`. Slugs: bet365, betano, superbet, blaze, estrelabet. Corpo JSON limitado a 8 MiB:

```text
{provider, collectionRunId, collectedAt, esport, kind, scope, fetchedAt,
 events: NormalizedEvent[], observations: MarketBatch[]}
```

Cada mensagem representa **um scope transacional** da rodada. A rodada do scheduler pode gerar vários scopes, cada um com UUID próprio e estável na outbox. `eventId` é o providerEventId externo existente; não é UUID SQL. Markets/selections, odds nullable, suspensão e timestamps de cada mercado são preservados. `collectedAt` corresponde a `fetchedAt`. Observações completas em scopes separados preservam abas parciais; não se converte uma captura parcial em lista completa.

V1 exclui raw/provenance e URLs de transporte; conserva apenas o tipo de transporte/captura e o indicador de autenticação da fonte; não precisa de HTML, browser state, cookies, headers ou credenciais. O server rejeita metadados raw não vazios. Checkpoints recebidos não são aceitos: o server constrói seu checkpoint normalizado.

`ingestion_runs` registra provider + collectionRunId + hash na **mesma transação** de entidades, snapshots, scopes, matching e issues. Reenvio exato não duplica dados; reutilização do ID com conteúdo diferente retorna 409. Falha SQL reverte inclusive o recibo. O ledger por scope/timestamp também continua idempotente. Recibos não são purgados automaticamente. Só depois do commit o server recarrega a projeção e libera as invalidações SSE, sem snapshots/raw no stream.

A outbox grava JSON privado por rename atômico e fsync antes de confirmar aceitação ao scheduler. Um reinício reenvia pendências com seus IDs originais. Retry: 30/60/120/300 segundos; timeout por request default 30s; redirects rejeitados. Falhas de autenticação/validação também retêm a mensagem para diagnóstico até o limite de retenção. Limites: 64 MiB, 1.000 mensagens, 24h. Capacidade cheia rejeita nova aceitação e ativa backoff do scheduler; expiração remove apenas pendências e gera aviso. Não há garantia de retenção ilimitada. Use diretório exclusivo para uma instância agent e monitore os avisos. Nunca execute dois agents escritores sobre a mesma outbox.

`POST /internal/agents/heartbeat` usa o mesmo token: `{agentId,providers,at}`. O server guarda no máximo 100 agents em memória, mede online pelo horário **de recebimento** (90s) e expõe `GET /internal/agents`, autenticado. Restart do server exige novo heartbeat. Heartbeat não renova odds: ausência do agent deixa dados stale pelo MAX_AGE_SECONDS existente. Poll de heartbeat default 30s, independente da entrega de odds.

## macOS, Chrome e processo

Para um agent limitado aos três providers HTTP em Windows, veja [Collector-agent neste Windows](WINDOWS_AGENT.md). Bet365 e Betano permanecem desabilitados nessa instalação.

Para os cinco providers, o PC atual precisa ser um **Mac com sessão gráfica e Chrome headed existente**, conforme [Local CDP](LOCAL_CDP.md). O agent não lança Chrome, não fecha o browser pessoal e administra apenas targets próprios. Superbet/Blaze/EstrelaBet continuam HTTP. Linux/systemd não habilita Bet365/Betano nesta etapa.

Use o equivalente nativo **LaunchAgent** na mesma conta do Chrome:

1. Crie `~/Library/Application Support/NexusBet/{releases,outbox}` e `~/Library/Logs`.
2. Instale Node 22.12+ e crie `~/Library/Application Support/NexusBet/node` como symlink para seu executável estável. Esse Node não deve depender do diretório descartável do Actions runner.
3. Salve `agent.env` nesse diretório, ajuste os caminhos absolutos e aplique `chmod 600`. O shell carrega esse arquivo; mantenha valores corretamente entre aspas, sem comandos.
4. Faça `npm ci`, checks e build no serviço. Copie `dist`, `node_modules`, `package.json` para uma release; crie `current` apontando para ela. Copie `run-macos.sh` para o diretório NexusBet.
5. Copie o [plist de exemplo](../apps/odds-service/runtime/agent/com.nexusbet.collector-agent.plist.example) para `~/Library/LaunchAgents/com.nexusbet.collector-agent.plist`, substituindo REPLACE_USER.
6. `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nexusbet.collector-agent.plist` e `launchctl kickstart gui/$(id -u)/com.nexusbet.collector-agent`.

RunAtLoad inicia ao login e KeepAlive reinicia após saída/falha. **Após boot, é necessária a sessão gráfica e o Chrome/CDP disponível**; um daemon antes do login não substitui esse requisito. Para PC dedicado, configure a sessão de usuário conforme a política local. Logs vão a `~/Library/Logs/nexusbet-agent*.log`; configure rotação local. `launchctl kill SIGTERM gui/$(id -u)/com.nexusbet.collector-agent` envia SIGTERM; Nest para timers, drena coleta/commit e encerra os próprios targets. Evite `kickstart -k`, que força término. Para manutenção sem restart, use `launchctl bootout` e aguarde graceful shutdown. O limite do plist é 180s: ajuste se drenagens reais exigirem mais.

## GitHub Actions self-hosted

O [workflow](../.github/workflows/collector-agent.yml) executa por push/merge em main que altere odds-service, sem polling próprio do GitHub. Instale o runner oficial no Mac, sob a mesma conta da sessão gráfica, com labels `self-hosted`, `macOS`, `odds-collector`. Restrinja o runner ao repositório confiável e proteja main; ele executa código do repositório e tem acesso ao ambiente local.

Checkout → npm ci → typecheck/format/build/test → cópia para release por SHA → troca de current → SIGTERM via launchctl kill. Env, Chrome e outbox permanecem fora do checkout. O workflow é serializado e não cancela deploy em curso. Falhas de build não trocam a release. Falha no comando de restart restaura o symlink anterior. Depois do deploy confira logs e heartbeat no server; o workflow não atesta saúde dos bookmakers. Para rollback, aponte current para uma release anterior e envie stop ao LaunchAgent. Releases antigas são mantidas para rollback; remova manualmente as que não serão usadas.

## Validação

Checks em apps/odds-service: `npm run build`, `npm run typecheck`, `npm run format:check`, `npm test`. `TEST_DATABASE_URL` terminado em `_test` habilita `npm run test:db`; a suíte usa migrations/TRUNCATE. Nunca use banco útil. Testes de transporte devem usar HTTP local e fixtures sanitizadas, sem consultar bookmaker real. Deploy remoto e captura real dos cinco providers precisam de validação operacional separada; configuração entregue não significa Railway/runner validado.

Este documento substitui descrições antigas de coleta HTTP no Railway e API exclusivamente GET. Os guias históricos de Xvfb/Chrome próprio não autorizam esses runtimes.

## Server validado no Railway — 2026-09-15

Atualizado o serviço existente `odds-service`, projeto `nexusbet`, ambiente `production`, por upload direto da CLI. Deployment: `349119f6-fe79-41c8-836c-118e9d949471` (SUCCESS). URL: https://odds-service-production-f25c.up.railway.app.

- Nova migration `202609150002_ingestion_runs` aplicada pelo pre-deploy.
- `/health`: HTTP 200, runtime server, PostgreSQL connected, externalCollectorsRunning=0, scheduler.running=false.
- As cinco rotas de ingestão rejeitam token incorreto com 401; payload vazio autenticado retorna 400 antes de persistir.
- `/monitor/providers` e `/monitor/stream`: HTTP 200; SSE com content-type text/event-stream.
- Token e URL do server salvos fora do repositório em arquivo privado `~/Library/Application Support/NexusBet/railway-server-ingestion.env` (0600).

Nenhum payload de odds de teste foi enviado à produção. Nenhum agent foi iniciado/registrado; novas coletas dependem da instalação no PC. Esta validação substitui a ressalva anterior apenas para o deploy do **server**. Runner self-hosted, LaunchAgent e captura real via agent ainda precisam de validação operacional.

O deploy inicial usou os arquivos locais pela CLI. A origem GitHub do serviço foi preservada; pushes em `main` publicam a versão do código no repositório pelo autodeploy existente.
