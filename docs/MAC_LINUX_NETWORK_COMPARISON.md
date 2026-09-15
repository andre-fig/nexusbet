# Mac headed funcional × Linux/Xvfb — sequência de rede

15/09/2026 UTC. Nenhuma alteração de parser, scheduler, PostgreSQL ou arquitetura. Capturas somente leitura; nenhum replay de endpoint, login, cópia de cookies, alteração de User-Agent ou otimização.

## Resultado

- **Bet365:** controle funcional obtido no Chrome pessoal do Mac: eSports → CS2 → `/contentdata/othersportsmatchmarketscontentapi/list`, 200 e 20.038 bytes. Linux executa os mesmos cliques, mas não emite feed. Antes disso, há diferença estrutural em `/leftnavcontentapi/validcompetitions`: Mac envia três pares `cl/cid` e recebe três itens; Linux não envia query e recebe `[]`, ambos 200.
- **Betano:** a mesma request GET `/api/sportsbook-settings`, sem query, retorna **200 JSON no Mac versus 403 HTML no Linux**. Headers de aplicação e origem coincidem; contexto de perfil, browser, idioma e POP diferem. A regra remota que recusa Linux não foi identificada.

A primeira tentativa de conexão Mac falhou no CDP. Após confirmação do usuário, a segunda conectou e capturou. Isso foi resolvido; os resultados abaixo substituem a conclusão provisória de falta de controle Mac.

## Ambiente e controle experimental

| Variável | Mac | Linux/Xvfb |
|---|---|---|
| Chrome | 152.0.7977.83 | 153.0.8010.36 |
| Modo | Headed pessoal existente | Headed em display virtual |
| Perfil | Pessoal antigo, usado no local, sem copiar cookies | Técnico novo |
| Locale JS / timezone | pt-BR / America/Sao_Paulo | Iguais |
| Viewport | 1800×860 | 1440×900 |
| Plataforma/UA natural | macOS, Chrome 152 | Linux x86_64, Chrome 153 |
| Máquina/container | macOS | Docker amd64 sob Rosetta no host ARM |
| IP público | Não medido | Não medido |
| Sessão/autenticação | Perfil tem cookies históricos ligados a conta; não houve login novo nem verificação de autenticação atual | Perfil técnico novo; sem login |

Não é A/B de variável única: não concluir que sistema operacional, versão, viewport, IP ou cookie específico explica sozinho o resultado. POP diferente não prova IP de saída diferente. O Mac pessoal não é controle anônimo limpo.

A sonda cria/fecha somente suas próprias tabs no Mac e não fecha o browser pessoal. No Linux, encerra Chrome e Xvfb ao concluir. Ativação de controles visíveis por texto via DOM, mesma rotina nos dois ambientes: não equivale necessariamente a ponteiro real; o feed 200 no Mac demonstra que a rotina consegue chegar à listagem. Não usa coordenadas nem interpreta HTML como fonte de odds.

## Bet365: sequência alinhada

Capturas pareadas aproximadamente simultâneas: Mac 01:04:22–01:04:25; Linux 01:04:24–01:04:52.

| Etapa/request | Mac | Linux |
|---|---|---|
| Homepage | 200 | 200 |
| eSports clicado | 01:04:23.368 | 01:04:26.894 |
| `/pullpodapi/gethomepagepods` | 200, 60.466 bytes | 200, 61.108 bytes; segunda emissão também observada |
| `/leftnavcontentapi/allsportsmenu` | 200, 12.680 bytes | 200, 12.680 bytes; hash diferente |
| `/footerapi/sitecontent` | 200, 8.272 bytes | 200, 8.272 bytes |
| `/leftnavcontentapi/validcompetitions` | índice 24, query `cl,cid,cl,cid,cl,cid`; 200, array de 3 itens, 110 bytes | índice 105, **sem query**; 200, array vazio `[]`, 2 bytes |
| CS2 clicado | 01:04:23.618 | 01:04:27.197 |
| `/pullpodapi/gethomepageadditionalpods` | 200, 384.422 bytes | 200, 384.422 bytes; hash diferente |
| `/BetsWebAPI/config` | 200, 89 bytes | Não observada |
| `/contentdata/othersportsmatchmarketscontentapi/list` | índice 120, **200**, 20.038 bytes | **Não emitida** |

A tabela alinha funções, não força uma ordem global artificial: `validcompetitions` foi emitida no Mac às 01:04:23.422, antes do clique CS2; no Linux às 01:04:27.286, depois do clique. Essa diferença de ordem também indica estados iniciais distintos.

**Primeira diferença estrutural isolada no contexto de competições:** o frontend Linux emite `validcompetitions` sem os parâmetros presentes no Mac. A diferença já existe **na request**, antes da resposta vazia; não é um 403 nem uma resposta de listagem removida pelo parser.

Há diferenças anteriores de tamanho/hash em pods e menu, além de downloads de bundles e ordem de recursos. Portanto não seria correto chamar `validcompetitions` de primeira diferença de qualquer byte de toda a sessão. É a primeira diferença de entrada/saída de competições isolada nesta análise. Os corpos de pods não foram interpretados semanticamente; não se conhece ainda qual campo anterior produz essa diferença de contexto.

**Limite causal:** não foi demonstrado que `validcompetitions` controle diretamente a emissão da listagem — pode refletir preferências/estado anterior do perfil. Não corrigir artificialmente a query nem copiar storage para fazê-la coincidir. Também não houve controle de versão de Chrome, viewport ou autenticação. A hipótese mais sustentada é **contexto inicial/navegação da SPA diferente**, com causa upstream ainda não determinada. Não há evidência de 403 no feed Bet365 neste par.

A primeira sonda, que clicava apenas eSports, não produziu listagem em nenhum ambiente. Selecionar a modalidade era necessário para obter o controle funcional do Mac; os arquivos `*-modality` são o par válido para essa comparação.

## Betano: comparação da request de configurações

Mac às 01:03:30.907, índice 298; Linux às 00:56:07.592, índice 347. Mesma rotina, mas janelas separadas em cerca de 7 minutos.

| Campo | Mac | Linux |
|---|---|---|
| URL | `https://www.betano.bet.br/api/sportsbook-settings` | Igual |
| Query / método | Sem query / GET | Igual |
| Origin | Header ausente | Ausente |
| Referer | `https://www.betano.bet.br/` | Igual |
| Accept | `application/json, text/plain, */*` | Igual |
| x-kbversion | `3.66.0` | Igual |
| Sec-Fetch | mode=cors, site=same-origin, dest=empty | Igual |
| Accept-Language | `pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7` | `pt-BR` |
| User-Agent | Natural Chrome 152/macOS | Natural Chrome 153/Linux |
| sec-ch-ua / platform | Chrome/Chromium 152; macOS | Chrome/Chromium 153; Linux |
| sec-ch-ua-mobile | `?0` | `?0` |
| Cookies | Perfil antigo, conjunto maior | Técnico novo, conjunto menor |
| Status | **200** | **403** |
| Content-Type | `application/json; charset=utf-8` | `text/html; charset=UTF-8` |
| Corpo decodificado | 3.301 bytes, objeto JSON com chave `data` | 358 bytes, HTML, não JSON |
| Server / encoding | cloudflare / zstd | Iguais |
| CF POP | GIG | GRU |
| CF cache status | DYNAMIC | Não presente |
| Cache-Control | Não presente nos headers capturados | private, max-age=0, no-store, no-cache, must-revalidate, post-check=0, pre-check=0 |
| Vary | accept-encoding | Igual |
| Disk cache / service worker | Não / não | Não / não |

O corpo HTML Linux não continha os marcadores procurados `attention required`, `sorry, you have been blocked`, `cf-chl-` ou `challenge-platform`. Não foi exibido um challenge explícito nessa resposta; ausência desses marcadores não exclui bloqueio remoto. Não foram gravados corpos integrais ou valores de credenciais.

### Cookie names

Comuns enviados: `_cfuvid`, `sticky_sb`, `cf_clearance`, `_fs_sample`, `_cq_duid`, `_cq_suid`, `_cq_session`, `_lr_hb_-7hhr6m%2Fstoiximangr`, `_lr_tabs_-7hhr6m%2Fstoiximangr`, `siteid`, `OptanonConsent`.

Somente no Mac nessa request: consentimento/estado antigo (`ageVerificationModal`, `sb_landing`, `OptanonAlertBoxClosed`, `isRegistered`, `RegistrationTimeStamp`), `datadome`, `GAUTH`, `Customer Type`, `kz_trusted_device_[redacted]`, antiforgery `.AspNetCore.Antiforgery.*`, `_tz`, `_tz_intl`, cookies analíticos e nomes dinâmicos redigidos. Lista sanitizada completa em `betano-settings-comparison.json`.

Os cookies enviados não tinham blockedReasons locais. Mac também tinha `thx_guid` e `tmx_guid` registrados como **DomainMismatch**, portanto não enviados — não tratar esses nomes como headers efetivos. Ter `cf_clearance` nos dois lados não comprova mesma validade, valor ou vínculo; nenhum valor foi comparado, copiado ou reproduzido.

### Requests imediatamente anteriores

Ordem de emissão; não prova relação causal. Todas abaixo foram emitidas pela aplicação, sem chamadas manuais a funcionalidades de apostas.

| Ambiente | Índices | Requests anteriores a settings | Status |
|---|---|---|---|
| Mac | 293–295 | assets `bet-mentor-backgrounds`, `stake-validation`, `bet-mentor-widget.css` | 200 |
| Mac | 296–297 | assets `BookingCodeConfirmationModal`, `ConfirmationModal` | 200 |
| Linux | 342–343 | eventos de telemetria kumulos; identificador redigido | 204 |
| Linux | 344 | asset `messages.sportsbook.pt_BR...js` | 200 |
| Linux | 345–346 | mesmos assets `BookingCodeConfirmationModal`, `ConfirmationModal` | 200 |

**Primeira divergência do endpoint solicitado:** 200 JSON versus 403 HTML. A URL, método, versão da aplicação e headers de origem são equivalentes. A hipótese mais sustentada é uma **decisão remota de acesso dependente do contexto da requisição**, servida via Cloudflare. Não é possível escolher entre estado do perfil/sessão, rota de rede, browser ou política de edge/origin com esse único par. Não afirmar que login é necessário.

## Evidências request por request

Em `apps/odds-service/evidence/mac-linux-flow/`:

- `mac-modality/bet365.json`, `linux-modality/bet365.json`: sequência completa até listagem/timeout, com índices e timestamps, headers sanitizados e resumos.
- `bet365-request-comparison.csv`: alinhamento de requests same-origin por método+caminho+ocorrência; preserva índice original de ambos os lados, status, tamanho e nomes de query. Downloads paralelos e diferenças de ocorrência não são causalidade. Valores de query redigidos impedem comparar parâmetros não explicitamente visíveis por nome/ausência.
- `mac/betano.json`, `linux/betano.json`: contexto completo de settings e requests anteriores.
- `betano-settings-comparison.json`: extrato sanitizado para revisão direta.
- `probe.ts`, `probe-modality.ts`: sondas somente de diagnóstico, sem alteração no serviço.

O Chrome pessoal permaneceu aberto; apenas as tabs criadas pela sonda foram fechadas. Containers de diagnóstico encerrados; nenhum polling ficou ativo. `git diff --check` passou. Não foram rodados testes de negócio porque não houve alteração de código funcional.
