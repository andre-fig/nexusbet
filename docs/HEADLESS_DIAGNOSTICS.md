> **Modo de produção atualizado:** Linux + Xvfb + Chrome Stable headed. A comparação abaixo é histórica; não há nova tentativa automática de headless. Veja [runtime de produção](PRODUCTION_RUNTIME.md).

# Chrome persistente: investigação headed/headless

## Matriz atual: somente homepage — 2026-09-14, 23:37–23:38 UTC

Esta rodada substitui as conclusões operacionais da investigação anterior **para a homepage**. Não testa nem declara listagem/coupon funcionando. O perfil antigo é o **Chrome pessoal já aberto**, confirmado pelo usuário; não é o perfil técnico usado na rodada anterior.

**Resultado:** nos dois providers, Chrome pessoal antigo e perfis novos **headed retornaram 200**; perfis novos **headless retornaram 403**, tanto no Mac quanto no Linux. A primeira divergência é o status da resposta do documento inicial `GET /`, antes de qualquer feed de odds.

### Protocolo da comparação

- Dez casos: cinco ambientes × dois providers; um acesso explícito à homepage por caso, sem retries, cliques, list/coupon ou login/logout. Contador de requests de feeds eSports: **zero nos dez casos**.
- Perfil pessoal usado no lugar, por CDP do Chrome já aberto: somente aba própria, fechada ao terminar. Browser/perfil do usuário não foi encerrado nem copiado. Estado de autenticação preexistente não foi investigado; não assuma que esse perfil é anônimo.
- Os outros oito casos começaram com perfis novos separados, **sem cookies no início**, sem importar cookies/storage do perfil pessoal ou de outro modo.
- Pares headed/headless usam o mesmo Chrome/Playwright e configuração de contexto em cada sistema: pt-BR, America/Sao_Paulo, viewport/screen 1440×900, scale 1, light, SW permitidos. Muda o modo de lançamento e seus efeitos naturais, incluindo UA/flags. Nenhum UA ou token foi fabricado.
- Mac: Chrome **152.0.7977.83**. Linux: Chrome **153.0.8010.36**, mesmo container amd64 sobre host arm64; headed com Xvfb 1440×900×24, sem interface de desktop externa. Playwright **1.63.0** / CDP **1.3**.
- Não foi possível igualar a major entre sistemas pelo pacote oficial consultado: o URL de distribuição Linux Stable 152.0.7977.83 retornou 404. Não houve downgrade do Chrome pessoal nem uso de binário de terceiros. As comparações **dentro de cada sistema** mantêm exatamente a mesma versão.
- Registro após DOMContentLoaded, sem networkidle ou sleep artificial. Ao receber 403, registra metadados e encerra a aba/contexto próprio, sem avançar. Cookies observados são os existentes nesse instante; a janela de coleta não mede todos os cookies que uma homepage aberta por minutos criaria.

### Bet365

| Caso | Chrome | Homepage HTTP | Final URL | Page title | Challenge/block detectado? | Cookies técnicos novos observados | Headers |
|---|---|---|---|---|---|---|---|
| Mac + Chrome pessoal antigo | 152.0.7977.83 | **200** | `https://www.bet365.bet.br/` | bet365 - Apostas Esportivas Online | Não observado | `__cf_bm` | `bet365-200`, POP `GRU` |
| Mac + perfil novo, headed | 152.0.7977.83 | **200** | `https://www.bet365.bet.br/` | bet365 - Apostas Esportivas Online | Não observado | `__cf_bm`, `aps03` | `bet365-200`, POP `GRU` |
| Mac headless + perfil novo | 152.0.7977.83 | **403** | `https://www.bet365.bet.br/` | Attention Required! \| Cloudflare | Sim: página de bloqueio Cloudflare; sem desafio interativo | `__cf_bm` | `bet365-403`, POP `GRU` |
| Linux headed (Xvfb) + perfil novo | 153.0.8010.36 | **200** | `https://www.bet365.bet.br/#[redacted]` | bet365 - Apostas Esportivas Online | Não observado | `__cf_bm`, `aps03`, `pers`, `pstk`, `rmbs`, `swt` | `bet365-200`, POP `GRU` |
| Linux headless + perfil novo | 153.0.8010.36 | **403** | `https://www.bet365.bet.br/` | Attention Required! \| Cloudflare | Sim: página de bloqueio Cloudflare; sem desafio interativo | `__cf_bm` | `bet365-403`, POP `GRU` |

### Betano

| Caso | Chrome | Homepage HTTP | Final URL | Page title | Challenge/block detectado? | Cookies técnicos novos observados | Headers |
|---|---|---|---|---|---|---|---|
| Mac + Chrome pessoal antigo | 152.0.7977.83 | **200** | `https://www.betano.bet.br/` | Aposta Esportiva - Casa de Apostas Esportivas Online \| Betano | Não observado | `cf_clearance` | `betano-200`, POP `GIG` |
| Mac + perfil novo, headed | 152.0.7977.83 | **200** | `https://www.betano.bet.br/` | Aposta Esportiva - Casa de Apostas Esportivas Online \| Betano | Não observado | `_cfuvid`, `sticky_sb` | `betano-200`, POP `GIG` |
| Mac headless + perfil novo | 152.0.7977.83 | **403** | `https://www.betano.bet.br/` | Betano Splash Screen | Sim: HTTP 403 + splash; sem desafio interativo observado | `_cfuvid` | `betano-403`, POP `GIG` |
| Linux headed (Xvfb) + perfil novo | 153.0.8010.36 | **200** | `https://www.betano.bet.br/` | Aposta Esportiva - Casa de Apostas Esportivas Online \| Betano | Não observado | `_cfuvid`, `cf_clearance`, `sticky_sb` | `betano-200`, POP `GRU` |
| Linux headless + perfil novo | 153.0.8010.36 | **403** | `https://www.betano.bet.br/` | Betano Splash Screen | Sim: HTTP 403 + splash; sem desafio interativo observado | `_cfuvid` | `betano-403`, POP `GRU` |

“Novos” compara nomes antes/depois: o perfil pessoal já tinha outros cookies e eles não foram tratados como recém-criados. Não foram exportados valores. Cookies criados por subrecursos/JS podem aparecer sem Set-Cookie no documento inicial.

### Headers de resposta sanitizados

A coluna Headers identifica o conjunto abaixo, medido em cada linha; o POP vem do sufixo de cf-ray, cujo identificador foi redigido. Datas exatas e lista de headers por resposta estão nos JSON locais. Não houve redirect HTTP do documento principal: a URL final permaneceu `/`. Na Betano, splash é conteúdo de bloqueio, não prova de redirect HTTP da homepage.

Todos os dez documentos: `server: cloudflare`, `content-type: text/html; charset=...`. `cf-mitigated` **não apareceu**; não foi observado CAPTCHA/challenge interativo. Sua ausência não prova ausência de regra de segurança.

| Conjunto | cf-cache-status | cache-control | content-encoding | x-frame-options | Outros |
|---|---|---|---|---|---|
| bet365-200 | DYNAMIC | no-cache, no-store, private, must-revalidate, max-age=0 | gzip | ausente | vary: accept-encoding; x-content-type-options: nosniff |
| bet365-403 | ausente | private, max-age=0, no-store, no-cache, must-revalidate, post-check=0, pre-check=0 | gzip | SAMEORIGIN | Charset reportado UTF-8 |
| betano-200 | HIT | ausente | zstd | ausente | vary: accept-encoding; x-content-type-options: nosniff |
| betano-403 | ausente | private, max-age=0, no-store, no-cache, must-revalidate, post-check=0, pre-check=0 | zstd | SAMEORIGIN | vary: accept-encoding; x-content-type-options: nosniff |

Set-Cookie do documento principal, **somente nomes**:

- Bet365 pessoal: `__cf_bm`; headed novo Mac/Linux: `__cf_bm`, `aps03`; headless Mac/Linux: `__cf_bm`.
- Betano pessoal: nenhum Set-Cookie observado no documento inicial; `cf_clearance` apareceu posteriormente no jar durante a observação. Demais casos: `_cfuvid` no documento inicial.

A presença de `__cf_bm`/`_cfuvid` também nos casos 403 prova apenas que cookies foram criados, não que houve sessão aceita. `cf_clearance` não foi necessário para obter o primeiro HTTP 200 do perfil novo Mac, cujo jar começou vazio. Não removemos cookies para testar causalidade nem transportamos clearance entre browsers.

### Primeira divergência comprovada e alcance da conclusão

```text
Mac, Chrome 152, perfis novos, configuração equivalente:
  headed   → GET homepage → 200 → título normal
  headless → GET homepage → 403 → bloqueio/splash → fim

Linux, Chrome 153, perfis novos, configuração equivalente:
  headed   → GET homepage → 200 → título normal
  headless → GET homepage → 403 → bloqueio/splash → fim
```

**Variável experimental que acompanha 200→403: modo de execução headed/headless.** O padrão se repetiu nos dois providers e nos dois sistemas. Como os perfis novos headed funcionaram, possuir um perfil antigo não é requisito para a homepage 200 nesta rodada. Como Linux headed funcionou, Linux/container sozinho também não explica o 403. Não é falha de parser, matching, Postgres ou scheduler: nenhum deles participa dos probes, e o servidor já entrega 403 para o primeiro documento HTML.

O 403 é recebido pela camada HTTP que expõe `server: cloudflare`; na Bet365 também há identificação visual explícita de bloqueio Cloudflare. Isso **não identifica a regra exata nem separa definitivamente decisão do edge de resposta de origem repassada por ele**, particularmente no splash personalizado da Betano. Seriam necessários logs de segurança/origem do operador para essa atribuição.

O fator “headless” inclui UA natural (`HeadlessChrome`), flags e diferenças internas do Chrome. Não isolamos qual subfator aciona a decisão. Não seria correto afirmar “é o User-Agent” ou “basta um cookie”. Perfis independentes começam igualmente vazios, mas decisões remotas, horário e rede continuam variáveis não controladas integralmente. A major difere entre Mac e Linux; o padrão foi replicado em pares de mesma versão, não em um experimento único de mesma major global.

A investigação anterior registrou uma tentativa headed Betano com 403. Ela não foi apagada: demonstra variabilidade temporal. Nesta matriz delimitada, todas as seis homepages headed deram 200 e todas as quatro headless deram 403. Isso é evidência reproduzida nesta amostra, não garantia permanente de disponibilidade.

### Evidências desta matriz e escopo de alteração

Diretório local ignorado pelo Git: `apps/odds-service/evidence/homepage-matrix/`.

- `summary.json`: dez resultados com status, URL/title, indicadores, cookies novos e headers sanitizados.
- `results/<caso>-<provider>.json`: medição individual e timestamps; perfis pessoais têm nomes anteriores de cookies apenas nos arquivos locais privados, sem valores.
- `results/*.png`: evidência visual dos perfis técnicos. Screenshots do perfil pessoal foram descartados por não serem necessários à comparação de metadados.
- `probe.ts` / `personal.ts`: probes descartáveis somente de homepage, sem imports de parser, matching, banco ou scheduler. `Dockerfile` local adiciona apenas Xvfb/xauth à imagem de diagnóstico já existente.

Não há alteração funcional nesta rodada. **Somente este documento foi atualizado no código versionável**; alterações da tarefa anterior foram preservadas. Nenhuma chamada a list/coupon, nenhuma cópia de cookies, nenhuma alteração de autenticação, nenhuma tentativa de contorno. Todos os processos/abas/containers criados para esses testes foram encerrados; o Chrome pessoal e PostgreSQL preexistentes permaneceram ativos.

---


[Índice](../README.md#documentation) · [Configuração](CONFIGURATION.md) · [Providers](PROVIDERS.md)

## Histórico da rodada anterior: resultado e limite da conclusão

A investigação localizou a primeira divergência **na resposta HTTP da homepage**, antes de listagem/coupon. Não tornou Bet365/Betano fontes headless funcionais. Não foi demonstrada a causa interna da decisão do servidor.

| Provider / execução | Headed, Chrome próprio | Headless, Chrome próprio |
|---|---|---|
| Bet365, comparação inicial | Homepage 200; SPA e storage carregados; coleta de listagem não concluída | Homepage 403; título `Attention Required! / Cloudflare`; nenhum list/coupon |
| Betano, comparação inicial | Homepage 200; SPA, storage, IndexedDB e service worker; modal de idade/consentimento impediu avanço | Homepage 403; `Betano Splash Screen`; nenhum feed eSports |
| Bet365, segunda execução | Homepage 200; eSports selecionado, região central sem oferta e nenhum request contentdata; WebSockets observados | Não houve repetição para insistir no 403 |
| Betano, segunda execução | Homepage 403/splash mesmo em headed | Não houve repetição para insistir no 403 |
| Linux amd64/container | Não testado com interface gráfica | Bet365 e Betano: homepage 403, antes de list/detail |

A segunda execução mostra que **o bloqueio não é exclusivo de headless**. A primeira resposta 200 vs 403 é observação, não prova de causalidade pelo User-Agent, IP, storage ou modo. Os perfis das comparações foram separados por modo; não houve transferência de cookies de headed para headless. Não há baseline headed com list/detail funcional nesta rodada.

Os três esportes e detalhe estavam na sequência do diagnóstico, mas a primeira etapa CS2 foi interrompida na homepage/listagem. LoL/Valorant e detalhe não foram alcançados; não podem ser marcados OK. Cinco ciclos remotos foram solicitados e interrompidos na primeira falha, não concluídos.

Blaze e EstrelaBet citados no pedido não existem neste checkout. Superbet usa HTTP, sem alteração de transporte nesta tarefa.

## Runtime medido

| Ambiente | Chrome | Executável | Playwright / CDP |
|---|---|---|---|
| macOS | 152.0.7977.83 | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` | 1.63.0 / 1.3 |
| Linux amd64 em Docker sobre host arm64 | 153.0.8010.36 | `/opt/google/chrome/chrome` | 1.63.0 / 1.3 |

Chrome Linux foi instalado do pacote oficial Stable. Como a versão difere do host, não atribua diferenças entre sistemas exclusivamente ao Linux. O teste usou emulação amd64, não produção nativa.

O lançamento usa channel=chrome e headless=true com argumento explícito `--headless=new`. A linha real também contém o `--headless` padrão do Playwright. Chrome moderno usa implementação unificada; não foi usado chrome-headless-shell ou Chromium bundled. [Documentação oficial Chrome](https://developer.chrome.com/docs/automation-and-testing/headless).

Flags acrescentadas pelo serviço: `--remote-debugging-port=0`, `--remote-debugging-address=127.0.0.1` e, apenas no modo invisível, `--headless=new`. As demais flags são defaults do Playwright e estão registradas integralmente em commandLine das evidências. Não foram removidos indicadores de automação, instalados plugins stealth ou trocados User-Agent/Client Hints. O User-Agent natural contém HeadlessChrome no modo headless e Chrome no headed.

Os defaults da biblioteca incluem opções como disable-background-networking, disable-extensions e no-sandbox; não se promete equivalência integral ao Chrome iniciado manualmente. Nenhuma dessas flags foi ajustada para influenciar o bloqueio. Locale pt-BR, timezone America/Sao_Paulo, viewport/screen 1440×900, scale 1 e colorScheme light foram medidos via page e estavam coerentes nos dois modos.

## Correções implementadas

- `OwnedBrowser` centraliza lançamento, perfil, fechamento e recuperação explícita.
- Perfil próprio em `data/browser-profile/<provider>`, persistente por default e nunca copiado do usuário. BROWSER_PERSISTENT=false mantém opção descartável explícita para testes.
- CDP anexa à page do **contexto persistente**, em vez de criar incognito adicional. Isso corrige o problema estrutural em que o diretório persistente não era usado pela coleta.
- Betano conserva browser/contexto entre listagens. Bet365 conserva a page gerenciada entre capturas; ambos reutilizam processos enquanto o collector estiver saudável.
- Bet365 começa pela homepage e clica eSports antes das rotas SPA; depois navega PD do catálogo/coupon, sem chamar feed diretamente. Não foi implementado replay de tokens ou HTTP interno manual.
- Betano mantém navegação homepage → eSports → modalidade/competição → evento. Locator handlers tratam consentimento por UI; confirmação de maioridade usa a autorização explícita já fornecida pelo usuário.
- Waits gerenciados usam DOMContentLoaded, locators e respostas; não dependem de networkidle. Foram removidos sleeps fixos de 500ms entre etapas de detalhe Betano. Utilitários CDP legados ainda contêm polling limitado para disponibilidade de seletor.
- Recursos não são bloqueados por route/abort: JS/CSS/imagens/fontes/fetch/XHR/WebSocket, service worker e cache ficam permitidos.

O perfil técnico contém valores privados necessários ao próprio browser. A proibição de exportar segredos aplica-se a logs, evidências, fixtures e banco de odds; cookies técnicos permanecem exclusivamente no perfil privado/ignorado pelo Git. SessionStorage permanece na mesma page, mas não é prometido após reinício do browser — é armazenamento de sessão por definição.

## Recovery e publicação

OwnedBrowser oferece recuperação explícita em ordem: reload → nova page no contexto → restart de contexto → restart do browser. Como launchPersistentContext possui o browser, os dois últimos passos são a mesma operação de fechar/reabrir mantendo userDataDir. A nova page retorna em branco e exige novo warmup; qualquer CDP associado à page anterior precisa ser reanexado.

**Não há retry automático dessa sequência sobre 403/CAPTCHA.** O scheduler conserva sua política existente: falha de transporte fecha o cliente; após backoff/cooldown abre novamente com o mesmo perfil e discovery. O helper de recovery está testado, mas não foi inserido como quatro tentativas adicionais dentro de cada coleta. Isso evita martelar uma proteção e alterar a política global.

Snapshots/stores/parsers não foram reescritos. O CLI de diagnóstico usa diretórios próprios e callbacks de publicação que não executa: não altera snapshots válidos, journals ou PostgreSQL. Rotas normais continuam preservando estado e TTL em falha. Não foi aumentado timeout/TTL para esconder o bloqueio.

## Comandos reproduzíveis

Dentro de `apps/odds-service`, com o scheduler normal parado:

```sh
npm run browser:diagnose -- --five-cycles
npm run browser:diagnose -- --betano --five-cycles
# Comparação visível explicitamente solicitada; nunca fallback automático:
npm run browser:diagnose -- --headed --five-cycles
npm run browser:diagnose -- --headed --betano --five-cycles
npm run browser:compare -- /caminho/headed.json /caminho/headless.json
```

Use arquivos de **sessão** com campo events no comparador, não os arquivos `*-result.json`. O comparador informa status inicial, emissão de list/detail e primeira divergência; se ambos retornam 403, informa falha compartilhada, sem culpar headless. Ele não valida payload nem prova causa remota.

Configuração central: BROWSER_MODE, CHROME_CHANNEL, BROWSER_PROFILE_DIR, BROWSER_PERSISTENT, BROWSER_LOCALE, BROWSER_TIMEZONE, BROWSER_VIEWPORT_WIDTH/HEIGHT e BROWSER_EVIDENCE_DIR. HEADLESS é fallback somente na ausência de BROWSER_MODE. CDP_URL/--existing/reuseProfile não escolhem perfil pessoal nos clients gerenciados; baixo nível legado permanece para testes/compatibilidade.

O diagnóstico separa perfis em `data/browser-profile/diagnostic/<plataforma>/<modo>/<provider>` e evidências por execução. Não rode duas instâncias no mesmo perfil. Um browser/contexto saudável é reutilizado entre ciclos; a pausa entre ciclos segue COLLECTION_LIST_INTERVAL_MS. A primeira falha encerra a execução.

## Linux/container

Dockerfile.browser-diagnostic é somente ambiente de diagnóstico; .dockerignore exclui .env, credentials, perfis, captures e artefatos. Executa como usuário node e não conecta ao banco.

```sh
docker build --platform linux/amd64 -f Dockerfile.browser-diagnostic -t odds-browser-diagnostic .
docker run --name odds-browser-check --platform linux/amd64 --shm-size=1g \
  -v odds-browser-profiles:/service/data \
  -v odds-browser-evidence:/service/evidence \
  odds-browser-diagnostic npm run browser:diagnose -- --betano --five-cycles
# Após encerrar, copiar evidência; não exportar o profile:
docker cp odds-browser-check:/service/evidence ./evidence-linux
# Remover somente o container de diagnóstico encerrado, conservando os volumes:
docker rm odds-browser-check
```

O pacote Chrome usado é amd64; --platform é obrigatório no host arm64. Para testar apenas recursos locais, sem casas:

```sh
docker run --rm --platform linux/amd64 --shm-size=1g -e BROWSER_TESTS=1 \
  odds-browser-diagnostic npx tsx --test src/modules/collection/tests/owned-browser.test.ts
```

Startup, cinco ciclos locais no mesmo contexto, persistência entre reinícios, cache, SW e WebSocket foram validados em Linux. List/detail reais falharam com 403. Não houve teste de longa duração de consumo de memória: verificar page/context count constante não equivale a provar ausência de todo memory leak.

## Evidências e proteção de dados

Arquivos locais ignorados em `apps/odds-service/evidence/browser/`:

- `diagnostic/darwin/headless/<provider>/headless-last-session.{json,png}`: primeira falha na homepage.
- `diagnostic/darwin/headed/<provider>/headed-last-session.{json,png}`: última execução headed anterior à mudança para nomes únicos.
- `container/{bet365-linux,betano-linux}/...`: metadados/screenshots de 403 em Linux.
- `runtime/macos-headless.json`: executável/flags reais medidos sem acessar bookmakers.
- `bet365-comparison.json`, `betano-comparison.json`: comparação dos arquivos de sessão disponíveis.

As primeiras execuções usavam nome last-session: a segunda headed substituiu o arquivo da primeira. A observação inicial Betano 200 foi registrada durante a investigação, mas o artefato headed atual representa a repetição 403. Isso não deve ser apresentado como captura bruta ainda disponível da primeira execução. O código final usa timestamp no diretório e nome de sessão para evitar novas sobrescritas.

Metadados incluem versão/CDP/Playwright, executável e commandLine, UA natural, locale/timezone/dimensões, nomes de cookies/chaves/databases, service workers, URLs com query/hash redigidos, redirects, status/content-type/tamanho, falhas de rede/WebSocket e origem de erros. Textos arbitrários de console/exception são omitidos para não exportar segredos; categoria/localização permanecem. Não há HAR, response bodies ou headers de autenticação no coletor de evidência. Screenshots são de páginas anônimas e permanecem locais.

O buffer de eventos é limitado a 5000 entradas por sessão. As medições finais incluem heap/documentos/nodes quando disponíveis, sem promessa de monitoramento contínuo. Evidence não pode impedir o fechamento seguro do transporte. Não há purge automático de perfis/evidências.

## Validação e situação final

Testes normais usam mocks/fixtures, sem internet. Browser opcional usa servidor HTTP/WebSocket local, verifica cookies antes de nova navegação, localStorage/IndexedDB/cache/SW após restart, cinco ciclos no mesmo contexto e CDP na mesma page persistente. Testes anteriores cobrem timeout, publicação tardia, stale, isolamento e journal; testes novos cobrem configuração, lifecycle, Betano reuse e comparação.

| Item | Resultado |
|---|---|
| Bet365 HEADLESS / LIST / DETAIL / 5 CYCLES reais | NÃO / NÃO / NÃO / NÃO |
| Betano HEADLESS / LIST / DETAIL / 5 CYCLES reais | NÃO / NÃO / NÃO / NÃO |
| Chrome Stable / headless moderno | OK / OK |
| Perfil persistente / storage preservado | OK / OK, verificação local e Linux |
| Service workers / WebSockets | OK / OK como capacidade local; não comprova feed remoto |
| Container/Linux | OK para runtime/storage; NÃO para list/detail remotos |
| Primeira divergência observada | Homepage HTTP 200 headed versus 403 headless; antes dos feeds |

O critério atendido é a demonstração técnica do ponto de divergência, não uma promessa de coleta headless resolvida. Não houve alteração de User-Agent, cópia de cookies, login ou contorno de desafios.

Referência de API: [Playwright launchPersistentContext](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context), que mantém armazenamento no userDataDir e possui seu único contexto. O comportamento efetivo desta instalação foi medido, não inferido apenas dessa documentação.

Validação final desta revisão: build, typecheck e format:check OK; suíte completa com browser local 96/96; PostgreSQL 23/23. Os testes não substituem a validação remota que falhou. Nenhum coletor foi deixado rodando após a investigação.

## Investigação posterior: headed Linux e recursos

Veja [ACCESS_RESOURCE_DIAGNOSTICS.md](ACCESS_RESOURCE_DIAGNOSTICS.md) para a primeira falha de cada provider, comparação com a homepage matrix, RSS/CPU por processo e falha de SingletonLock no perfil persistido. A homepage 200 anterior não validou feeds. A nova sonda reproduziu Bet365 sem feed após clique E-Sports e Betano 403 de bootstrap mais modal interceptando navegação, sem alterar o pipeline.

Comparação pareada posterior: [Mac funcional × Linux/Xvfb](MAC_LINUX_NETWORK_COMPARISON.md). Mac emitiu listagem Bet365 após seleção de CS2. `validcompetitions` saiu com três pares cl/cid no Mac e sem query no Linux. Betano settings: 200 JSON Mac versus 403 HTML Linux. Essas diferenças não isolam uma causa única de ambiente.
