# Bet365 e Betano: runtime local CDP

## Matriz de suporte atual

| Provider | LOCAL MAC/CDP | LOCAL WINDOWS/CDP | LINUX/XVFB | HEADLESS |
|---|---|---|---|
| Bet365 | SUPPORTED | SUPPORTED | UNSUPPORTED | UNSUPPORTED |
| Betano | SUPPORTED | SUPPORTED | UNSUPPORTED | UNSUPPORTED |

SUPPORTED significa estratégia de transporte mantida para desenvolvimento/validação, não garantia de cobertura do feed em qualquer instante. Parsers continuam rejeitando estruturas inválidas. A implementação HTTP da Superbet permanece independente. Bet365/Betano não são production-ready em Railway.

As investigações de headless, Linux/Xvfb e HTTP pós-bootstrap estão encerradas nesta etapa. Os relatórios permanecem históricos; não são instruções para retomar experimentos.

## Preparar o Chrome existente no Mac ou Windows

1. Abra o Chrome pessoal/headed já funcional, no perfil usual. Não copie seu perfil nem inicie outro Chrome apontando para o mesmo diretório.
2. No Chrome que suporta a interface nativa usada neste projeto (validada com Chrome 152), abra `chrome://inspect/#remote-debugging`, habilite depuração remota e aceite o pedido de conexão quando o Chrome o apresentar. Essa autorização é do browser, não autenticação do odds-service.
3. O serviço lê `~/Library/Application Support/Google/Chrome/DevToolsActivePort` no Mac e `%LOCALAPPDATA%\Google\Chrome\User Data\DevToolsActivePort` no Windows. Se o Chrome usa outro caminho ou o agent roda como SYSTEM, configure `CHROME_DEBUG_PORT_FILE` com o caminho absoluto da conta do Chrome.
4. Alternativamente, defina `CDP_ENDPOINT=ws://127.0.0.1:<porta>/devtools/browser/<id>` obtido do próprio Chrome. Apenas WebSocket local é aceito; não exponha depuração à rede. Não commite o endpoint real. `CDP_URL` é alias legado.

O serviço não ativa a depuração sozinho, não altera preferências e não remove cookies. Se a versão do Chrome não oferecer esse fluxo, não crie automaticamente profile alternativo ou estratégia de acesso: marque a indisponibilidade e use a configuração local suportada.

Em `apps/odds-service/.env`:

```dotenv
BROWSER_RUNTIME=local-cdp
BET365_ENABLED=true
BETANO_ENABLED=true
CDP_RECONNECT_COOLDOWN_MS=300000
COLLECTION_ENABLED=true
```

`BROWSER_RUNTIME` ausente assume `disabled`. Flags de provider ausentes só assumem true quando `BROWSER_RUNTIME=local-cdp` está explícito e `NODE_ENV` não é production. Recomenda-se sempre configurá-las explicitamente. `HEADLESS`, `BROWSER_MODE`, `BROWSER_PROFILE_DIR` e flags de Chrome próprio não mudam a estratégia dos dois providers: **local-cdp não lança Chrome**.

Instale dependências, aplique migrations/seed e inicie conforme o README. Os comandos são executados no diretório do serviço:

```sh
npm run build
npm start
curl http://127.0.0.1:3650/health
```

Para validação limitada, pare o scheduler antes de iniciar um CLI separado. `npm run capture -- --detail` e `npm run capture:betano -- --detail` usam o mesmo runtime e podem publicar capturas conforme configuração. `npm run browser:diagnose -- --two-cycles` (ou `--betano --two-cycles`) usa publishers diferidos, não publica snapshots e para na primeira falha. Não há troca automática de acesso.

## Ownership, isolamento e shutdown

`BrowserModule` injeta `LocalCdpService` nos clients Bet365/Betano. O gerenciador:

- Cria targets `about:blank` próprios no contexto existente; nunca adota uma tab preexistente.
- Reutiliza uma tab por provider, com lock abrangendo listagem/detalhe; adapters apenas anexam/desanexam CDP dessa tab.
- Não enumera/navega tabs do usuário, não altera storage nem faz logout.
- Compartilha conexão CDP através do lease existente; não cria browser/contexto pessoal novo.
- Só envia `Target.closeTarget` para targets que ele criou. Nunca envia `Browser.close` ou `Target.disposeBrowserContext`.
- No shutdown, para novos trabalhos, espera jobs/drenagem do Nest, fecha targets próprios e solta a conexão WebSocket. Chrome e tabs pessoais permanecem abertos.

O transporte Bet365 usa homepage/eSports no aquecimento e as rotas PD existentes para listagem/detalhe. O target deixa de ser recriado a cada navegação. Betano utiliza o caminho CDP já existente de navegação normal por links/abas. Endpoints, parsers e normalização não foram alterados.

## Scheduler, indisponibilidade e dados antigos

Só inclui Bet365/Betano na agenda se flag enabled, runtime local-cdp e processo em macOS ou Windows. Fora disso, `/health` informa `disabled` (flag false) ou `unavailable` (runtime/plataforma inadequado), sem impedir Superbet/API de funcionar.

Se o CDP faltar/falhar, a conexão é lazy e o erro não impede bootstrap do Nest. O gerenciador marca unavailable e limita reconexão real a uma tentativa por cooldown (padrão 5min, mínimo configurável 60s), compartilhado pelos dois providers. O scheduler mantém seu backoff/circuit breaker existente; tentativas dentro do cooldown não abrem conexão. Falha de captura também fica unavailable; uma resposta aceita volta a ready no gerenciador/ok no scheduler.

O Chrome pode pedir autorização para cada nova sessão de depuração. As conexões CDP aguardam no máximo 120s pela aprovação. Para uma instalação local que dependa desse aviso, configure `PROVIDER_LIST_TIMEOUT_MS` e `PROVIDER_DETAIL_TIMEOUT_MS` acima desse prazo (por exemplo, 180000); o scheduler continua abortando a tentativa e aplicando backoff quando o limite termina. Sem Chrome aberto e sem aprovação do usuário, os dois providers permanecem unavailable.

Em uma captura sanitizada de CS2 no Windows (15/09/2026), a Bet365 retornou um evento futuro com `IB=2`, duas odds e `SU=0`. Como o significado de `IB=2` ainda não está confirmado, o parser conserva o evento/odds e o marca suspenso, sem tratá-lo como finished nem incluí-lo no matching automático. A fixture retém somente campos permitidos do protocolo; não contém headers, cookies ou corpo bruto.

O último estado aceito permanece intacto durante falhas; TTL/stale e journal continuam nas implementações existentes. Uma captura rejeitada não publica nem remove eventos. `EventRemoved != EventFinished`.

## Produção

```dotenv
BROWSER_RUNTIME=disabled
BET365_ENABLED=false
BETANO_ENABLED=false
```

Esses defaults estão explícitos no Dockerfile e Compose runtime. O image/runtime histórico ainda contém Chrome/Xvfb; eles não constituem suporte desses providers e nenhum client Bet365/Betano usa o gerenciador de Chrome próprio. Sua remoção/otimização não faz parte desta tarefa. Outros providers mantêm seus transportes independentes.

## Testes

`local-cdp.test.ts` valida ownership real do protocolo por mocks de conexão, targets reutilizados, locks, cooldown, ausência de launch/fallback, shutdown/drenagem e Nest com providers indisponíveis. Testes existentes de stores/scheduler mantêm rejeição, TTL e preservação de snapshots. Testes normais não usam Chrome pessoal nem sites.

As classes antigas `BrowserManagerService`/`OwnedBrowser` e relatórios de diagnóstico permanecem fora da DI de produção dos dois providers para preservar testes locais e histórico. Sua existência não autoriza fallback. Não retomar Linux/headless ou mudar parser para fazer validação passar.

## Validação desta migração — 15/09/2026 UTC

Implementação verificada com build, typecheck e Prettier; **113 testes passaram, quatro opcionais ignorados, zero falhas** (117 total). Testes adicionais verificam target fechado recriado isoladamente, ausência de listeners acumulados e rejeição de endpoint CDP que anuncie HeadlessChrome/plataforma não Mac, sem fechar browser pessoal.

API local iniciada com runtime disabled respondeu `/health` com Bet365/Betano disabled e zero tabs próprias; shutdown drenou scheduler. Não houve acesso a PostgreSQL nessa checagem (PERSISTENCE_MODE=file), nem mudança em migrations/models/parsers/matching.

**Validação real completa NÃO aprovada:**

- Bet365 entregou captura CS2 via CDP (15/09 01:18:50 UTC), porém o parser existente rejeitou `Missing/duplicate winner selections`. O parser não foi relaxado nem a captura publicada.
- A tentativa Betano não completou a primeira listagem; não foi demonstrado detalhe/cobertura dos três esportes nessa tentativa.
- A rodada final limitada (01:27:22 UTC) tentou dois ciclos com CS2/LoL/Valorant de ambos, mas a conexão CDP ficou unavailable; o cooldown impediu novas conexões dentro da janela. Isso são dois ciclos **tentados**, não dois ciclos bem-sucedidos.
- Nenhuma publicação foi executada; último estado válido permaneceu preservado. Ao encerrar, zero targets próprios restantes no gerenciador. Nenhum Chrome alternativo/headless/Linux foi iniciado.

Evidências locais: `evidence/local-cdp-validation/*/result.json`, captura Bet365 em `evidence/browser/diagnostic/darwin/headed/2026-09-15T01-18-44-691Z/`. Os dados não são fixtures de produção nem prova de disponibilidade contínua. O pedido de confirmação CDP do Chrome, quando apresentado, precisa ser aceito pelo usuário; habilitar a opção de depuração não garante que toda conexão nova seja aceita.

A investigação Linux/headless permanece encerrada. Corrigir incompatibilidade de parser, se necessário, é outra tarefa; este relatório não autoriza mudança de regra nem ampliação de estratégia de acesso.
