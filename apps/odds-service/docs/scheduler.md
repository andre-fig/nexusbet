# Scheduler

Com COLLECTION_ENABLED=true, `npm start` ou `npm run start:prod` iniciam a coleta após 3 segundos mais jitter de até 5 segundos. O código habilita por default, mas .env.example usa false. HEADLESS=true lança Chrome próprio invisível; Chrome existente com CDP autorizado só é necessário no diagnóstico HEADLESS=false. Não há cron externo ou fila distribuída.

O ciclo é: **startup → tick global → listagens vencidas → catálogo normalizado → detalhes vencidos por proximidade → coleta/validação → publicação → journals/snapshots**. Listagens têm prioridade para manter contexto atual. O tick de 1 segundo só coordena memória; ele não consulta os sites a cada segundo. A fila é derivada das entradas únicas de estado, sem timer por evento.

| Variável | Default |
|---|---:|
| COLLECTION_ENABLED | true |
| COLLECTION_STARTUP_DELAY_MS | 3000 |
| COLLECTION_TICK_MS | 1000 |
| COLLECTION_LIST_INTERVAL_MS | 60000 |
| DETAIL_INTERVAL_GT_24H_MS | 600000 |
| DETAIL_INTERVAL_6H_24H_MS | 300000 |
| DETAIL_INTERVAL_1H_6H_MS | 120000 |
| DETAIL_INTERVAL_LT_1H_MS | 60000 |
| COLLECTION_JITTER_MS | 5000 |
| BET365_MAX_CONCURRENCY / BETANO_MAX_CONCURRENCY / SUPERBET_MAX_CONCURRENCY | 1 |
| PROVIDER_LIST_TIMEOUT_MS / PROVIDER_DETAIL_TIMEOUT_MS | 60000 |
| PROVIDER_FAILURE_THRESHOLD | 5 |
| PROVIDER_COOLDOWN_MS | 300000 |
| SHUTDOWN_GRACE_MS | 30000 |
| COLLECTION_BACKOFF_FIRST_MS | 30000 |
| COLLECTION_BACKOFF_SECOND_MS | 60000 |
| COLLECTION_BACKOFF_THIRD_MS | 120000 |
| COLLECTION_BACKOFF_MAX_MS | 300000 |

Exatamente 24h ou 6h usa a faixa 6h–24h; exatamente 1h usa a faixa 1h–6h. Datas inválidas e eventos iniciados não recebem detalhe. Eventos removidos/iniciados não são marcados como finished pelo scheduler. Snapshots antigos permanecem no journal e a API aplica o TTL anterior.

Cada provider tem limite efetivo 1 porque seu transporte usa uma sessão mutável; valores maiores configurados são limitados a 1 e expostos no health. No headless, providers usam browsers próprios distintos. No diagnóstico com Chrome externo, podem usar sessões/abas distintas em uma conexão CDP compartilhada por referência. Fechar uma aba não encerra a conexão do outro coletor. Nenhuma sessão da conta é copiada.

Timeout cancela a coleta, descarta publicações pendentes e fecha o transporte próprio. O lock só é liberado após drenagem segura, para não sobrepor uma operação tardia. Falhas mantêm o catálogo anterior e aplicam backoff por evento; rejeições de parsing preservam uma sessão utilizável e não impedem outros detalhes. Falhas de transporte/timeout fecham a sessão. Após cinco falhas globais consecutivas o provider pausa por cinco minutos. Qualquer sucesso global zera essa sequência; falhas por evento permanecem independentes até seu sucesso. Uma conexão fechada exige nova listagem antes de detalhes. Os journals existentes registram as mudanças; o scheduler não cria um journal paralelo.

`GET /health` acrescenta status, providers e scheduler aos campos antigos. Mostra tentativas/sucessos de listagem, falhas consecutivas, cooldown, limites configurados/efetivos e jobs ativos/pendentes, sem dados sensíveis. Estado operacional por evento é mantido em memória e reconstruído por discovery no restart.

SIGINT/SIGTERM interrompe a criação de jobs, aguarda o grace period, cancela a parte de browser restante e aguarda drenagem. Uma publicação já iniciada é concluída sem abortar append/rename. Um transporte não cooperativo ou disco bloqueado pode prolongar o shutdown para preservar integridade. Logs indicam scheduler_stopping e scheduler_stopped.

Os intervalos são alvos de elegibilidade, não garantia de latência para todo o catálogo: concorrência, duração de navegação, prioridade, jitter e backoff podem atrasar tarefas. O TTL não foi ampliado para esconder esse atraso. Capturas/journals continuam crescendo em disco sem política nova de retenção. Use apenas uma instância escritora/coletora por diretório; os locks não atravessam processos.


A Superbet participa do mesmo registry, com estado, lock, backoff e circuit breaker próprios. Sua coleta usa HTTP direto; o limite conservador efetivo continua sendo uma operação por provider. Intervalos, timeout e TTL são os compartilhados.

Referência consolidada: [Collection](../../../docs/COLLECTION.md) e [Configuration](../../../docs/CONFIGURATION.md).

## Atualização: browser persistente

BROWSER_MODE=headless/headed agora seleciona Chrome próprio em ambos os modos. O perfil técnico persiste por provider; não há cópia de perfil pessoal nem contexto incognito adicional. HEADLESS é fallback legado; CDP_URL não seleciona transporte externo nos clients atuais. Betano conserva o browser entre listagens. O scheduler continua com os mesmos locks/backoff/TTL. [Diagnóstico e limites atuais](../../../docs/HEADLESS_DIAGNOSTICS.md).
