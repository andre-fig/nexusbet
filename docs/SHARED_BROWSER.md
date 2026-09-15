> **Histórico para Bet365/Betano:** a estratégia Linux/Xvfb/Chrome próprio foi abandonada nesta etapa. O runtime atual usa [Local CDP no Mac](LOCAL_CDP.md). Configure BET365_ENABLED=false, BETANO_ENABLED=false e BROWSER_RUNTIME=disabled em Railway. Os resultados e detalhes anteriores abaixo são preservados como histórico, não suporte atual.

# Chrome compartilhado no odds-service

O runtime usa **um Google Chrome Stable headed, um contexto persistente e uma main tab por provider que usa browser**. No checkout atual são duas tabs: Bet365 e Betano. Superbet usa HTTP e não ganha uma tab ociosa. Blaze/EstrelaBet são alvos futuros, não providers implementados. O gerenciador aceita chaves genéricas de provider; cadastrar uma tab não implementa um coletor.

```text
Linux + Xvfb :99
  Nest / BrowserModule
    BrowserManagerService (singleton Nest)
      Chrome Stable / contexto persistente único
        main Bet365: listagem + detalhes
        main Betano: listagem + detalhes
      profile: /service/data/chrome-profile
  Superbet: HTTP, sem browser
```

Um browser ainda possui processos de renderer, GPU, zygote e utilitários. `browser count = 1` não significa um único PID de Chrome. Não desabilitamos o modelo multiprocesso, recursos, service workers ou indicadores de automação.

## Contrato e ownership

- `shared/browser/browser.module.ts` exporta o singleton `BrowserManagerService`. Bet365Module, BetanoModule e HealthModule importam esse mesmo módulo.
- `getPage(provider)` deduplica chamadas simultâneas e reutiliza a main tab. A aba inicial about:blank do contexto é aproveitada pelo primeiro provider; não sobra uma tab extra.
- `runExclusive(provider, action, signal)` cobre a operação completa de listagem/detalhe, incluindo transições de navegação. Um segundo job do mesmo provider é rejeitado como busy; providers diferentes podem operar simultaneamente. O scheduler existente mantém sua fila/locks/concurrency.
- `warmup(action)` serializa o primeiro carregamento de homepage/SPA. A lógica de navegação continua no provider; o gerenciador não conhece endpoints ou parsers. Readiness só é marcada após uma operação de coleta bem-sucedida, não após homepage 200.
- Clients pegam uma referência CDP à tab via `openManagedFeed`. `close()` do adapter **apenas detach/release da sessão CDP**. Ele não destrói tab, contexto ou Chrome. Erros ao anexar uma sessão também não fecham uma tab emprestada.
- `isCurrent()` impede usar um adapter ligado a um target que já foi substituído. Betano precisa restaurar contexto de listagem antes de obter detalhes após perder a page, conforme validação existente.
- `OwnedBrowser` permanece como primitive de lançamento/compatibilidade e testes. Os clients de produção não o instanciam por provider; o manager é seu único proprietário.

O lançamento é lazy: o primeiro job do scheduler inicia o Chrome, após o startup delay. API sem coleta (`COLLECTION_ENABLED=false`) não gasta memória com um browser. CLI Nest usa o mesmo módulo; CLI de diagnóstico cria exatamente um manager e o fecha explicitamente. Não iniciar CLI de coleta em paralelo ao Nest sobre o mesmo profile/journal.

## Perfil compartilhado

Default local `data/chrome-profile`; imagem `/service/data/chrome-profile`. O valor é o diretório do **próprio perfil**, sem acrescentar o nome do provider. Cookies/localStorage/IndexedDB/cache/service workers permanecem sujeitos às regras normais de origem do Chrome; sessionStorage permanece associado à tab. Não há cópia de perfil pessoal, cookies ou credenciais.

Os diretórios técnicos antigos por provider não são apagados nem mesclados automaticamente. O novo default inicia um profile técnico novo. Para reaproveitar um perfil técnico existente, pare a instância anterior e aponte explicitamente BROWSER_PROFILE_DIR para aquele diretório único; os outros sites criarão seu storage normalmente nele. Não aponte dois processos para o mesmo diretório nem remova locks enquanto Chrome estiver ativo.

Não há implantação de contextos extras como fallback. Se aparecer conflito real de storage entre providers, registre evidência antes de alterar essa decisão.

## Tabs extras e recovery

Os dois providers atuais usam a mesma main tab para listagem e detalhe. `withDetailPage(provider, callback)` existe para necessidade futura comprovada: requer lock do provider, permite no máximo uma tab extra e a fecha em finally, em sucesso ou falha. Chamadas simultâneas são rejeitadas antes de alocar uma segunda tab.

- Tab fechada/crashada: próxima aquisição recria apenas aquela tab no contexto existente.
- Abort/timeout do scheduler: a tab afetada é fechada antes de liberar o lock, cancelando possíveis ações Playwright ainda pendentes. O próximo job recria essa tab. Não reinicia peers.
- Erro comum de HTTP/feed/parser: registra falha, preserva a main tab e o browser; backoff/circuit breaker existentes continuam valendo. Não contornar 403 nem repetir desafios.
- Chrome/contexto realmente encerrado: invalida referências e reabre um único contexto persistente sob demanda, preservando o profile. `recoverBrowser()` oferece recovery explícito quando não há jobs ativos. Em `launchPersistentContext`, contexto e processo Chrome têm o mesmo ciclo de vida.
- Não existe fallback automático para headless, nem restart global a cada erro de provider.

## Listeners e diagnósticos

Há um `BrowserEvidence` por contexto. Os handlers de consentimento/idade são registrados uma vez por page, não a cada reabertura do adapter. Os listeners de feed CDP continuam temporários, adicionados antes da operação e removidos em finally. Uma sessão CDP é detached ao liberar o adapter; a conexão CDP de baixo nível é compartilhada por referência.

O diagnóstico do manager usa a tab do provider solicitado e não abre uma tab chrome://version por polling. Metadados de rede são sanitizados, limitados a 5.000 entradas por contexto; não representam um log infinito. As evidências de rede podem conter eventos de ambos os providers do contexto, com origem/timestamp para distingui-los. Parsers seguem processando apenas sessões/feeds de seu provider.

## Health e memória

`GET /health` acrescenta `browser`: mode, browsers, contexts, tabs, Node RSS/heap e estado por provider (status, URL sanitizada, lastUsedAt, lastSuccessAt, busy, failureCount, mainTabs/detailTabs).

Em Linux, `browser.resources` amostra `/proc/*/status`, no máximo uma vez a cada 10s de consultas de health. Só conta descendentes Chrome do processo Nest; não lê command line/environment. `chromeRssBytes` é a **soma de RSS dos processos** e pode contar páginas de memória compartilhadas mais de uma vez. Não comparar diretamente com working-set do container. RSS por provider não é atribuído artificialmente: processos/recursos podem ser compartilhados. Evidências de page trazem métricas CDP de heap quando disponíveis.

Para custo Railway, meça o container inteiro (Nest + Chrome + Xvfb), incluindo trabalho de persistência, e acompanhe `/health` para verificar que não surgiram tabs extras. CPU 100% representa um core. Uma rodada curta com falhas não prova ausência de memory leak nem dimensiona produção.

## Configuração/runtime

```dotenv
BROWSER_MODE=headed
DISPLAY=:99
BROWSER_SHARED_INSTANCE=true
BROWSER_SHARED_CONTEXT=true
BROWSER_PROFILE_DIR=/service/data/chrome-profile
BROWSER_PERSISTENT=true
PROVIDER_MAIN_TAB=true
PROVIDER_DETAIL_TAB_MAX=1
BET365_MAX_CONCURRENCY=1
BETANO_MAX_CONCURRENCY=1
SUPERBET_MAX_CONCURRENCY=1
```

O gerenciador exige BROWSER_PERSISTENT=true. Flags de shared instance/context/main tab só aceitam true/1; false falha claramente na configuração. Detail max aceita 0 ou 1. Blaze/EstrelaBet ainda não têm scheduler ativo nem consumidor de suas variáveis de concorrência.

Docker/Railway e volumes seguem [PRODUCTION_RUNTIME](PRODUCTION_RUNTIME.md). Não adicionar outro supervisor: tini/entrypoint mantêm Xvfb ativo até o término do Node. Nest primeiro drena o scheduler e libera os adapters; no shutdown da aplicação o manager fecha tabs, contexto e Chrome; depois o runtime encerra Xvfb. O prazo externo de draining deve permitir esse fechamento. Usar uma réplica escritora.

## Testes

`browser-manager.test.ts` cobre singleton/contexto único, cinco chaves de provider, reuse, locks, paralelismo, crash de tab/browser (inclusive SIGKILL do Chrome próprio em teste Linux), abort isolado, tabs de detalhe limitadas, warmup serializado e shutdown. O teste opcional Linux/Xvfb faz cinco ciclos em servidor HTTP local, detach/reanexo CDP, verifica número de listeners/tabs e restaura storage após restart. Ele não acessa bookmakers.

```sh
# Em apps/odds-service
npm test
npm run build
npm run typecheck
npm run format:check
```

A suíte normal não depende de internet. O teste real compartilhado requer `BROWSER_TESTS=1` e `DISPLAY` para usar headed; os utilitários headless legados restantes são testes locais, fora do caminho de produção.

## Validação real desta mudança

Rodada em **15/09/2026, 00:20:22–00:23:46 UTC**, Linux amd64 sob emulação em Mac ARM, Chrome Stable **153.0.8010.36**, Playwright **1.63.0**, headed/Xvfb. Banco e volume exclusivos de validação; sem credenciais de bookmaker e sem copiar cookies.

| Verificação | Resultado observado |
|---|---|
| Browsers | **1**, um único PID principal Chrome (56) durante a janela |
| Contextos | **1**, também confirmado por conexão CDP independente |
| Main tabs | **2**, Bet365 e Betano, IDs de target iguais antes/depois das três tentativas |
| Detail tabs / tabs abandonadas | **0** |
| Processos Chrome totais | Máximo amostrado **12**, incluindo renderers/utilitários |
| Bet365 homepage | 200; sem emissão de `/contentdata/` após navegação |
| Betano homepage | 200 inicialmente; retornou 403 em navegações posteriores, mesma tab/browser |
| Bet365 e Betano CS2/LoL/Valorant/detalhe | Listagem não passou; demais modalidades e detalhes não foram alcançados com sucesso |
| Bet365 cinco ciclos completos | **NÃO: 0/5**, três tentativas falharam |
| Betano cinco ciclos completos | **NÃO: 0/5**, três tentativas falharam |
| Superbet | HTTP preservado: quatro listagens de 86 eventos e 68 detalhes concluídos |
| Blaze / EstrelaBet | Não implementados; nenhuma captura real alegada |
| Shutdown | SIGTERM drenou o job ativo, zero jobs finais, exit 0; depois Xvfb encerrou |

A falha de provider não reiniciou o Chrome. As tabs mantiveram os IDs `2B1DC743BC156133573158445BA45C31` (Bet365) e `3E375E70E6263F2841532EB955D0F7E5` (Betano) durante a rodada. Nenhuma requisição list/coupon foi simulada para passar validação real. A instrumentação leu apenas contagens, status/URLs sanitizadas e metadados. Os probes locais de transporte não se confundem com essa execução.

### Recursos e limites da medição

Amostragem de aproximadamente 5s do cgroup do container (38 registros, um inicial sem health completo). RAM = memory.current menos inactive_file; CPU = delta usage_usec dividido pelo tempo monotônico. Inclui Nest, Chrome, Xvfb, persistência e instrumentação; exclui o PostgreSQL de outro container.

| Métrica | Valor |
|---|---:|
| RAM média | **2.081 MiB (2,03 GiB)** |
| RAM pico amostrado | **2.371 MiB (2,32 GiB)** |
| CPU média | **98,9%** (0,99 core) |
| CPU pico amostrado | **380,1%** (3,80 cores) |
| Tempo médio de coleta válida Bet365/Betano | Indisponível: nenhuma listagem válida |
| Tempo médio de listagem Superbet observado no health | **5,11s**, três conclusões amostradas; a quarta terminou durante shutdown |

A rodada anterior tinha duração, quantidade de detalhes e ciclo de vida diferentes: fechava browsers após falhas. Agora eles ficam vivos, como solicitado. **Não é uma comparação A/B controlada**; não afirmar redução de RAM média a partir desses números (a média desta janela foi maior). O ganho comprovado é eliminar a segunda instância/contexto e evitar recriações; processo principal e targets ficaram estáveis. Não há evidência suficiente para afirmar ausência de memory leak em execução prolongada.

O banco isolado reteve **86 eventos, 3.033 mercados e 8.761 snapshots**. O restart com coleta desabilitada foi verificado separadamente, sem iniciar Chrome desnecessariamente. O volume/profile permanece disponível; nenhum dado anterior do usuário foi apagado.

Evidências locais ignoradas: `apps/odds-service/evidence/shared-browser/{samples.jsonl,resources.json,targets-final.json,health-final.json,nest.log,container-state.json,network/}`. Não versionar profiles/cookies. Testes finais: **107/107 no Linux/Xvfb**, incluindo cinco ciclos HTTP/CDP locais com sucesso e falha de feed simulado, reuse de adapters e contagem de listeners; **23/23 PostgreSQL**. Build/typecheck/format:check aprovados.

**Railway:** o runtime compartilhado está preparado, mas a coleta real de Bet365/Betano continua não validada. Não declarar pronto como fonte autônoma nem usar homepage 200 como substituto para feeds/cinco ciclos completos. Os testes e o polling desta rodada foram encerrados.
