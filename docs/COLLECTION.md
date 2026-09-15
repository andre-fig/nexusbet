# Coleta contínua

[Índice](../README.md#documentation) · Implementação: [collection/](../apps/odds-service/src/modules/collection) · [Configuração completa](CONFIGURATION.md).

## Responsabilidades e fluxo

SchedulerService usa timers Nest/lifecycle simples, sem @Cron por evento, cron externo ou fila distribuída. AdaptiveScheduler contém a agenda testável com relógio/random injetáveis. CollectionService chama ProviderRegistry, controla coleta manual e mantém a fronteira de publicação.

```text
startup → restore → startup delay + jitter → tick global
  → provider livre / fora de cooldown
  → listagem vencida primeiro
  → senão detalhe vencido mais próximo do início
  → coleta → validação → commit diferido → refresh → leitura aceita
  → sucesso ou backoff → próximo tick
```

O tick padrão de 1000ms **não consulta sites a cada segundo**. Só inicia tarefas vencidas. O scanner de inbox é independente (5000ms), com proteção contra refresh simultâneo do próprio timer.

## Intervalos reais

| Tarefa / tempo restante | Intervalo default |
|---|---:|
| Listagem de cada um dos três providers | 60s |
| Mais de 24h | 600s |
| De 6h a 24h, incluindo limites | 300s |
| De 1h até menos de 6h | 120s |
| Mais de zero e menos de 1h | 60s |
| Iniciado ou startsAt inválido | Sem detalhe pré-jogo |

Função: `getDetailInterval` em scheduling-policy.ts. Exatamente 1h usa 120s; exatamente 6h/24h usa 300s. Elegibilidade também exige !inPlay e status scheduled/suspended. Ao descobrir live/início durante um detalhe, EventStartedError para a tarefa sem contar falha e sem marcar finished. Uma mudança futura de startsAt permite reavaliar parada anterior.

No sucesso, `nextRunAt = lastAttemptAt + intervalo`. Cada tick recalcula intervalos sem falha ao aproximar-se do início. Jitter é guardado separadamente e somado na verificação de vencimento: aleatório positivo abaixo de min(COLLECTION_JITTER_MS,10000), default até 5s. Health nextListRunAt não inclui esse jitter. Dentro dos detalhes, ordena por startsAt e depois eventId.

## Estado e concorrência

ProviderState guarda tentativa/sucesso/próxima listagem, falhas consecutivas, cooldown, contexto pronto e jobs ativos. DetailState usa provider:eventId, esport, startsAt, tentativa/sucesso, nextRunAt, failureCount, lastError, currentlyRunning e jitter. Fila é derivada desse estado único, não uma coleção de timers individuais.

Configuração de concorrência aceita valores ≥1, mas **effectiveConcurrency é sempre 1** atualmente, inclusive Superbet. Valores maiores produzem log concurrency_capped e aparecem como configuredConcurrency no health. Isso protege sessões mutáveis. Providers diferentes podem executar em paralelo; um provider não executa listagem e detalhe simultaneamente. Após restart/falha de transporte é necessária discovery antes de detalhes.

A agenda é em memória. PostgreSQL restaura catálogo, não locks/failureCount/tarefas em andamento. `restoreCatalog` não inventa EventAdded. Não existe coordenação de scheduler entre processos: use uma instância.

## Falhas, timeout e circuit breaker

Timeout default 60s para listagem e detalhe. AbortSignal encerra operação e fecha transporte quando apropriado; callbacks ainda não publicados são descartados. Lock só é liberado após operação/limpeza terminarem, evitando sobreposição tardia. Transportes não cooperativos podem atrasar essa liberação: timeout não é encerramento forçado de processo.

Falha mantém catálogo/snapshot válido. failureCount da tarefa sobe, e nextRunAt passa a agora + backoff de **30/60/120/300s**, mais jitter. Sucesso zera falha da tarefa. Listagem, abort e erro de transporte invalidam contexto e exigem nova discovery; erro de parsing de detalhe pode preservar transporte utilizável.

Cada falha contada também incrementa consecutiveFailures do provider. Após **5**, cooldown de **300s** bloqueia novos jobs. Qualquer sucesso global zera a sequência do provider; não zera falhas independentes de outros detalhes. Ao terminar cooldown, força tentativa de listagem. EventStartedError e cancelamento de shutdown tratado não contam como falha normal.

Publicação começa somente após validação. `beginCommit` limpa timeout e protege escrita já iniciada. O sucesso exige que refresh aceite a versão publicada; escrever inbox sozinho não basta.

## Discovery e remoção

Listagem válida reconcilia catálogo e agenda: adiciona eventos novos, remove tarefas dos ausentes e atualiza startsAt. Falha não substitui catálogo por vazio. Stores/journal registram EventAdded/EventRemoved nos scopes apropriados; catalogChanges em memória é operacional, não um segundo journal persistente.

`EventRemoved != EventFinished`. Últimos snapshots ficam preservados; rotas normalizadas continuam aplicando TTL de 600s. Detalhes distantes com intervalo 600s podem vencer o TTL por jitter, fila ou lentidão. Não há extensão automática do TTL.

## Startup e shutdown

Código default habilita coleta; `.env.example` escolhe false para onboarding seguro. Após startup normal, restaura/ingere estado, espera 3000ms + jitter e executa primeira discovery sem aguardar 60s completos.

SIGTERM/SIGINT: para timers e novos jobs, aguarda até SHUTDOWN_GRACE_MS=30000, aborta operações ainda fora de commit, drena trabalhos e fecha clientes. Commits já iniciados são aguardados mesmo além do grace period; disco/transporte bloqueado pode prolongar shutdown. PostgreSQL desconecta no hook final, depois da drenagem.

## Health, CLI e limites

`/health` expõe providers com starting/ok/degraded, lastListAttemptAt/SuccessAt, consecutiveFailures, cooldown, activeJobs e limites; scheduler mostra running/queuedJobs/activeJobs/scheduledDetails. queuedJobs conta entradas vencidas, inclusive temporariamente bloqueadas; não é tamanho de uma fila externa.

CLIs `capture*` fazem ciclo manual; `--detail` escolhe um evento por modalidade. `collect*` são loops legados com CAPTURE_INTERVAL_SECONDS=180, não a agenda adaptativa. Eles desabilitam scheduler/ingestão próprios e escrevem inboxes. Não rode coletor manual junto com scheduler ativo da mesma instalação.

Intervalos são metas de elegibilidade. Listagens demoradas, prioridade de discovery e capacidade 1 podem atrasar detalhes. Testes de relógio falso, publicação tardia e shutdown estão em collection/tests; não é necessário consultar sites para validar a agenda.

## Atualização: browser persistente

BROWSER_MODE=headless/headed agora seleciona Chrome próprio em ambos os modos. O perfil técnico persiste por provider; não há cópia de perfil pessoal nem contexto incognito adicional. HEADLESS é fallback legado; CDP_URL não seleciona transporte externo nos clients atuais. Betano conserva o browser entre listagens. O scheduler continua com os mesmos locks/backoff/TTL. [Diagnóstico e limites atuais](HEADLESS_DIAGNOSTICS.md).

## Atualização: Chrome compartilhado

O fluxo atual usa `BrowserModule`/`LocalCdpService`: CDP no Chrome pessoal existente do Mac, targets próprios reutilizados, sem fechar o browser pessoal. Superbet segue HTTP. Chrome próprio compartilhado/Xvfb é histórico, fora da DI desses providers.
