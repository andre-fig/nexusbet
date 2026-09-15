# Operação local dos providers de browser

Bet365/Betano: use [LOCAL_CDP.md](LOCAL_CDP.md) para habilitar CDP no Chrome Mac existente. `/health` apresenta disabled/unavailable quando flags/runtime/CDP não permitem coleta. Cooldown de reconexão padrão 5min; não fique reiniciando para evitá-lo. Em produção/Railway desabilite ambos. Nunca feche Chrome/tabs pessoais, limpe profile ou copie cookies para recuperar coleta.

# Operação e diagnóstico

[Índice](../README.md#documentation) · [Configuration](CONFIGURATION.md) · [Testing](TESTING.md)

Comandos deste documento partem de `apps/odds-service`. Use uma instância escritora/coletora. Não há Sentry nem deploy Railway validado; investigue logs Nest, respostas sanitizadas, fixtures e PostgreSQL. Não depende de contexto externo ou dashboard.

## Checklist de saúde

```sh
curl http://127.0.0.1:3650/health
curl 'http://127.0.0.1:3650/providers/superbet/health'
curl 'http://127.0.0.1:3650/providers/superbet/events?esport=cs2'
curl 'http://127.0.0.1:3650/comparisons?esport=cs2'
npm run db:status
```

Health HTTP 200 não significa odds atualizadas. Verifique scheduler.running, activeJobs, queuedJobs, lastListSuccessAt, consecutiveFailures e cooldownUntil de cada provider. `database.status` representa conexão/resultado de operações, não ping contínuo. Com coleta desabilitada, provider pode permanecer starting mesmo havendo histórico SQL.

Compare fetchedAt com MAX_AGE_SECONDS=600. A leitura normalizada exige cobertura fresca dos esports solicitados; sem query, normalmente solicita os três. Se só coletou CS2, use `?esport=cs2`. Uma fonte stale não impede comparação das demais; nenhuma fonte fresca resulta em 503.

## Captura manual limitada

Desative/pare scheduler ativo antes de rodar outro coletor. Estes CLIs fazem uma rodada e fecham recursos; publicam inboxes, cuja ingestão pela API persistirá os dados:

```sh
ESPORTS=cs2 npm run capture -- --detail
ESPORTS=cs2 npm run capture:betano -- --detail
ESPORTS=cs2 npm run capture:superbet -- --detail
```

`--detail` seleciona um evento por modalidade, não todos. EVENT_ID escolhe Bet365; BETANO_EVENT_ID escolhe Betano, com ESPORTS restrito. `--main-only` controla diagnóstico Bet365. `BROWSER_RUNTIME=local-cdp` usa Chrome existente; `--existing`/`--reuse-profile` não mudam essa política. Não há endpoint HTTP de trigger de coleta.

Para consumir capturas sem novo polling: `COLLECTION_ENABLED=false npm start`; INBOX_INGEST_ENABLED deve permitir ingestão. Não deixe `collect`/`collect:betano` rodando após diagnóstico. Somente Chrome pessoal/headed macOS para Bet365/Betano; indisponibilidade preserva dados até TTL, sem fallback.

## Sintomas e investigação

| Sintoma | Possível causa | Onde investigar |
|---|---|---|
| 0 eventos / 503 normalizado | Sem captura inicial, cobertura parcial, bloqueio remoto | client/collector/parser do provider; health e inbox sanitizada |
| Bet365/Betano splash ou 403 | Proteção remota, possível mesmo em headed | local-cdp.service, configuração/CDP e transportes; não tente Linux/headless ou contorno |
| Parser rejeita captura | Endpoint/layout/IDs ou cardinalidade alterados | parsers/ e fixture real equivalente; preserve erro |
| Queda grande de event count | Filtro de tempo/competição/cobertura ou oferta real menor | metadados da rodada e comparação com captura anterior; não assumir detector automático |
| Dados antigos | Fila, backoff, cooldown, coleta desabilitada | Collection/config, nextRunAt, lastSuccessAt, timestamps |
| Muitos unmatched | Competição, aliases, horário/status, candidatos ambíguos | matching.ts, names.ts, match_decisions |
| Odd null | Suspensão conhecida ou dado desconhecido | raw/flags e parser específico; não converter para zero |
| Mapas faltando | Sem oferta, detalhe não capturado, popular/main ou API de listagem | cobertura do detalhe, mercados salvos e rota consultada |
| Duplicatas rejeitadas | Mesmo provider:eventId com conteúdo conflitante | dedupe do parser/store, scopes e timestamps |
| Snapshots não avançam | Captura repetida/antiga, SQL ou refresh falhou | PersistenceService, publications, feed_scopes, journal |
| DB tem dados, arquivo atrasado | Falha de arquivo depois de commit SQL | disco/permissões e checkpoint; SQL é fonte de restore |
| Startup recusa migrations | Pendente, falha ou checksum editado | db:status e migration versionada; não edite aplicada |
| API SQL retorna mercado antigo | Consulta histórica sem TTL/remoção física | listed, last_seen_at, snapshots.fetched_at |
| Shutdown demora | Commit em andamento ou transporte não cooperativo | scheduler_stopping/stopped, disco e jobs; não interrompa escrita |

## Inspecionar banco e API

```sh
curl http://127.0.0.1:3650/providers
curl 'http://127.0.0.1:3650/provider-events?provider=superbet'
curl http://127.0.0.1:3650/events
curl 'http://127.0.0.1:3650/issues?status=open'
```

Use UUID interno retornado pela API para `/events/:uuid` e `/selections/:uuid/odds-history`. Nas rotas `/providers/<slug>/events/:id`, use ID externo. Não intercambie os dois.

Limites atuais: canonical events 50, provider events/issues 100, snapshots 200. Histórico usa before exclusivo e ordenação fetchedAt/createdAt desc; não há cursor completo para empates de timestamp. Decimais SQL vêm como strings. `/providers` conta eventos históricos, não somente oferta ativa. Consultas SQL não são feed de odds garantidamente frescas.

Issues automáticas são UNMATCHED_EVENT e conflitos LOW_CONFIDENCE. Não há detector completo de outlier, queda de contagem ou stale gerando issues. A ausência de issue não prova qualidade. Resolvido/ignorado ficam preservados; não existe endpoint público para alterar status.

## Migrations, restauração e importação

Aplique migrations com `npm run db:migrate`; valide `db:status`. Não use db push/synchronize em substituição. Faça backup antes de alterações destrutivas; não há automação de backup no repo. `docker compose down` para contêiner, preservando volume; não use `down -v` para uma parada normal.

Restart em modo postgres restaura checkpoints e baselines, sem atualizar fetchedAt. Verifique histórico antes/depois, catálogo e TTL. Modo file existe para compatibilidade, mas alternar modos não sincroniza automaticamente históricos.

Importação opcional com coletores parados:

```sh
npm run db:import-legacy -- --root /caminho/para/diretorio-de-capturas
# Após revisar a simulação e preparar o destino:
npm run db:import-legacy -- --root /caminho/para/diretorio-de-capturas --apply
# Para retomar a mesma importação:
npm run db:import-legacy -- --root /caminho/para/diretorio-de-capturas --apply --resume
```

Sem --apply não conecta/grava. Lê inbox/detail-inbox/betano-inbox/superbet-inbox e reaplica parsers por timestamp. Não importa NDJSON isolado nem faz backfill antes do último scope já publicado. O scanner normal também ingere inboxes: planeje diretórios novos para não confundir importação e coleta. [Guia PostgreSQL](../apps/odds-service/docs/postgres.md).

## Evidência de incidente

Registre provider/esport/eventId, timestamp UTC, endpoint sem segredos, cobertura esperada/recebida, erro sanitizado e teste que reproduz. Mantenha fixtures reais intactas; crie fixture adicional sanitizada se necessário. Nunca anexe cookies, perfis, credentials.txt ou dumps de headers. Compare odds com UI somente em navegação de leitura autorizada, encerrando recursos ao final.

## Atualização: browser persistente

BROWSER_MODE=headless/headed agora seleciona Chrome próprio em ambos os modos. O perfil técnico persiste por provider; não há cópia de perfil pessoal nem contexto incognito adicional. HEADLESS é fallback legado; CDP_URL não seleciona transporte externo nos clients atuais. Betano conserva o browser entre listagens. O scheduler continua com os mesmos locks/backoff/TTL. [Diagnóstico e limites atuais](HEADLESS_DIAGNOSTICS.md).

## Runtime de produção

Bet365/Betano têm suporte somente em local-cdp no Mac; desabilite ambos em Railway/Linux. Consulte [LOCAL_CDP](LOCAL_CDP.md). O runtime Xvfb documentado anteriormente é histórico.

## Atualização: Chrome compartilhado

O fluxo atual usa `BrowserModule`/`LocalCdpService`: CDP no Chrome pessoal existente do Mac, targets próprios reutilizados, sem fechar o browser pessoal. Superbet segue HTTP. Chrome próprio compartilhado/Xvfb é histórico, fora da DI desses providers.

## Blaze

Use `npm run capture:blaze -- --detail` e `/providers/blaze/health`. Em falha, verifique status HTTP do manifesto/shards, cadeia de versões e marcador de snapshot completo. Não publique captura parcial, não tente replay do endpoint individual bloqueado e não abra Chrome para compensar uma falha HTTP. [Procedimento e limitações](BLAZE.md).

## EstrelaBet

Use `npm run capture:estrelabet -- --detail`, `/providers/estrelabet/health` e `/health`. HTTP 403/non-JSON ou mudança de pageCount interrompem a rodada; não copie cookies nem abra Chrome como fallback. Valide todas as páginas de GetUpcoming e referências de IDs antes de substituir catálogo. Mercado auxiliar com novo ID pode produzir MarketAdded/Removed legítimos. Compare odds com a UI considerando truncamento de apresentação, preservando precisão no domínio. [Diagnóstico completo](ESTRELABET.md).

## Monitor interno

Consulte [Monitor](MONITOR.md) para rotas, CORS, SSE e testes. Se a tela mostra reconexão, confirme `/monitor/stream` e a origin exata; Sync continua sendo GET. Se receber 503, verifique PostgreSQL/PERSISTENCE_MODE, sem ativar fallback para mock. Uma UI vazia em banco novo é esperada; seed não cria eventos.
