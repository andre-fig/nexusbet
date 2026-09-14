# Odds Service

Backend NestJS somente leitura para odds pré-jogo de CS2, LoL e Valorant, com providers independentes bet365, Betano e Superbet, scheduler adaptativo, snapshots persistentes e matching conservador. Não depende de frontend, BFF ou banco externo.

## Executar

A partir da raiz do repositório:

```sh
cd apps/odds-service
npm ci
npm run build
npm start
# Ou executar o build compilado:
npm run start:prod
```

Execute apenas uma instância de cada vez. A API atende em `127.0.0.1:3650` por padrão (`PORT`). O scheduler começa automaticamente após o startup delay. Para somente API/ingestão, sem coletar nos sites:

```sh
COLLECTION_ENABLED=false npm start
```

Habilite a depuração remota nativa em `chrome://inspect/#remote-debugging` e autorize a conexão no Chrome. No macOS, o serviço encontra `DevToolsActivePort` do Chrome padrão; `CHROME_DEBUG_PORT_FILE` ou `CDP_URL` permitem configurar outro endpoint local autorizado. Bet365 e Betano usam contextos anônimos próprios, sem ler credentials.txt ou copiar sessões. Headless e perfis novos separados não estão validados para acesso real. A Superbet usa HTTP público direto, sem Chrome, login, cookies ou tokens.

## Verificação

```sh
npm run build
npm run typecheck
npm test
npm run test:browser
npm run format:check
# Suíte completa, incluindo browser opcional com feeds locais:
BROWSER_TESTS=1 npm test
```

Testes comuns usam mocks/fixtures e não consultam as casas. Fixtures e testes ficam dentro dos módulos em `src/modules/*/`.

## API

Somente GET; dados ausentes/vencidos retornam 503, demais métodos retornam 405.

- `/health`: saúde operacional, scheduler e providers.
- `/providers/bet365/events`, `/providers/betano/events` e `/providers/superbet/events`: domínio normalizado comum.
- `/providers/{provider}/events/:id`: detalhe; `?esport=cs2`, `lol` ou `valorant` restringe a modalidade.
- `/providers/{provider}/health`: estado do provider.
- `/comparisons` e `/matching/unmatched`: matching conservador entre fontes.
- `/matches`, `/matches/:id` e `/provenance`: contratos históricos bet365.
- `/providers/{provider}/matches` e detalhes: aliases compatíveis de events.

## Dados e configuração

ConfigModule lê variáveis do ambiente; não lê automaticamente .env ou credentials.txt. Diretórios relativos são resolvidos a partir do diretório de execução — use os comandos dentro de `apps/odds-service`.

| Diretório | Variável | Uso |
|---|---|---|
| `data/` | DATA_DIR | Estados e journals persistentes |
| `inbox/` | INBOX_DIR | Listagens bet365 |
| `detail-inbox/` | DETAIL_INBOX_DIR | Detalhes bet365 |
| `betano-inbox/` | BETANO_INBOX_DIR | Rodadas Betano |
| `superbet-inbox/` | SUPERBET_INBOX_DIR | Rodadas HTTP Superbet |
| `captures/` | CAPTURE_DIR | Capturas bet365 para diagnóstico |
| `captures/betano/` | BETANO_CAPTURE_DIR | Capturas Betano para diagnóstico |

Os dados operacionais e inboxes existentes foram preservados na mudança de diretório. Esses diretórios são ignorados pelo Git. Snapshots/journals são append-only; EventRemoved não implica EventFinished. TTL padrão: 600 segundos (`MAX_AGE_SECONDS`). O scanner de inbox roda a cada 5000 ms (`INBOX_SCAN_INTERVAL_MS`); `INBOX_SCAN_ENABLED=0` desliga seu timer e `INBOX_INGEST_ENABLED=0` desliga a ingestão.

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
# Processar uma fixture offline:
npm run normalize -- src/modules/bet365/fixtures/cs2.json
# Reproduzir snapshots históricos em um diretório separado:
npm run replay-snapshots -- /tmp/odds-replay
```

`ESPORTS=cs2,lol,valorant`, `EVENT_ID` e `BETANO_EVENT_ID` filtram a coleta manual. Os CLIs não escrevem diretamente nos journals: publicam nos inboxes para a API ingerir. Os loops manuais mantêm `CAPTURE_INTERVAL_SECONDS=180`, mínimo 60. O scheduler automático tem agenda própria.

## Estrutura e limites

`modules/bet365`, `modules/betano` e `modules/superbet` contêm protocolos, transportes, parsers e stores específicos. `collection` coordena a agenda; `snapshots` mantém o journal; `matching` recebe somente o domínio normalizado; `shared` contém domínio e infraestrutura neutra.

A coleta Betano cobre a aba popular. Bet365 captura as abas anunciadas e aceitas, excluindo Criar Aposta. Nem todo evento listado retorna detalhe utilizável; falhas preservam o estado anterior e aplicam backoff/circuit breaker. Intervalos são alvos, sujeitos à capacidade, fila e jitter. A API continua aplicando TTL. O encerramento fecha apenas abas próprias; contextos anônimos vazios ficam para o ciclo de vida do Chrome, pois sua destruição explícita já causou crashes na instalação testada.

- [Configuração e funcionamento do scheduler](docs/scheduler.md)
- [Campos e endpoints dos protocolos](docs/protocols.md)

Superbet: protocolo, validação e limitações em [docs/superbet.md](docs/superbet.md). A comparação aceita duas ou três fontes e conserva unmatched quando há ambiguidade; uma fonte sem dados frescos não impede a comparação das demais.
