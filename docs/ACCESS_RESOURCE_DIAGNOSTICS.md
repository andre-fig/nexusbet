# Diagnóstico de acesso e recursos — Linux/Xvfb

Investigação em 15/09/2026 UTC. Nenhuma alteração em parsers, matching, PostgreSQL, scheduler ou políticas de recuperação. Não foi feita otimização. Evidências locais sanitizadas em `apps/odds-service/evidence/`; perfis e evidências não devem ser commitados.

## Primeira falha na execução compartilhada anterior

Janela: 00:20:22–00:23:44 UTC, container `odds-shared-validation`.

| Observação | Bet365 | Betano |
|---|---|---|
| Homepage inicial | 200 às 00:20:34.992 | 200 às 00:20:30.965 |
| URL final | `https://www.bet365.bet.br/` com fragmento SPA sanitizado | `https://www.betano.bet.br/` |
| Título | bet365 - Apostas Esportivas Online | Inicial: Aposta Esportiva - Casa de Apostas Esportivas Online \| Betano; depois: Betano Splash Screen |
| Bloqueio/challenge visual | Não comprovado; região central sem conteúdo | Homepage inicial não era página de bloqueio; chamadas internas 403 HTML; depois homepage 403/splash |
| Primeira falha relevante registrada | Feed `/contentdata/` não emitido; timeout de captura às 00:20:59 | `/api/sportsbook-settings`, 403 às 00:20:33.765, `text/html; charset=UTF-8`, 4269 bytes |
| Fase | Não completou carregamento de eSports/feed. Probe separado clicou E-Sports e continuou sem feed | Antes de eSports; `/api/sport/esports/` não emitida |
| Tentativas seguintes | Homepage 200 em todas as três; nenhum 403 de odds comprovado | Homepage 403 às 00:21:35.931 e 00:22:41.867; não prosseguiu para feed |

Bet365 carregou `/leftnavcontentapi/allsportsmenu`, `/leftnavcontentapi/validcompetitions`, `/Api/1/Blob` e pods com 200. Há abertura de WebSocket registrada, mas esse registro sozinho não prova handshake/tráfego saudável. Nenhuma request de list/coupon com 403 foi encontrada. Duas requests auxiliares de gaming falharam apenas na segunda tentativa; não explicam a primeira falha, nem foram investigadas/reexecutadas.

Na Betano, depois do primeiro 403 ocorreram outros 403 de configurações/marketing e retries do próprio frontend. A screenshot inicial mostra modal promocional; não há prova de que ele seja a causa do 403. HTTP 403 comprova recusa, não identifica a regra interna do servidor/CDN. Não atribuir automaticamente a cookies, IP, fingerprint ou Xvfb.

Os arquivos `network/bet365/*.json` e `network/betano/*.json` contêm eventos de **ambos** os providers por compartilharem contexto. A análise acima filtra por hostname. Erros JavaScript antigos omitem mensagem e página de origem; não permitem atribuir o `SyntaxError` registrado a um provider com segurança. Timestamps de resposta são de registro no coletor, não captura de pacotes.

## Comparação com Linux headed 200 anterior

| Variável | Homepage matrix, 23:37–23:38 UTC | Runtime compartilhado, 00:20–00:23 UTC |
|---|---|---|
| Chrome / Playwright | 153.0.8010.36 / 1.63.0 | Iguais |
| Modo | Headed + Xvfb | Headed + Xvfb |
| Flags explícitas | `--remote-debugging-port=0`, `--remote-debugging-address=127.0.0.1` | Mesmas no código; linha completa não capturada no runtime |
| Defaults Playwright | Não há dump completo no resultado da matrix | Não há dump completo; não afirmar identidade de todos os argumentos |
| Locale / timezone | pt-BR / America/Sao_Paulo | Iguais |
| Viewport / screen | 1440×900, escala 1, light | Iguais; display :99, 24 bits |
| Perfil/userDataDir | Novo e individual: `/service/data/browser-profile/homepage-matrix/linux-headed/{provider}` | Novo compartilhado: `/service/data/chrome-profile`, persistido entre tentativas |
| Imagem | `84650598366c…`, probe isolado | `66da25f220e0…`, Nest + coleta Superbet + persistência |
| Rede Docker | `bridge` | `odds-service_default` |
| IP público | Não registrado | Não registrado; mesma máquina não prova mesmo egress |
| Chrome/context/tabs | 1/1/1 por teste isolado | 1/1/2 simultâneas |
| Cobertura | Homepage e snapshot em cerca de 3s; **zero requests de feed** | Bootstrap completo, tentativa eSports e três tentativas de coleta |

A comparação anterior **não validou odds em Linux**. O runtime também começou com homepage 200 nos dois providers; portanto não houve divergência inicial de status nessa comparação. A primeira divergência comprovada é a cobertura posterior: Betano recusa API de bootstrap; Bet365 não produz feed. Não existe A/B controlado que isole uma variável responsável pelo acesso.

Cookies iniciais da matrix: Bet365 `__cf_bm`, `aps03`, `pers`, `pstk`, `rmbs`, `swt`; Betano `_cfuvid`, `cf_clearance`, `sticky_sb`. Ambos: `server=cloudflare`, `content-type=text/html; charset=utf-8`, POP GRU. Bet365 `cf-cache-status=DYNAMIC`; Betano `HIT`. Valores de cookies não foram armazenados. Cookie names do contexto compartilhado não devem ser atribuídos a uma origem sem filtrar domínio.

## Recursos da execução completa anterior

38 amostras, com uma indisponível no início. Memória = working set do cgroup (`memory.current - inactive_file`). CPU = delta de `usage_usec`; 100% equivale a um núcleo. Médias aritméticas de amostras, não percentis nem limites de produção.

| Métrica | Valor |
|---|---:|
| Browser / context / tabs | 1 / 1 / 2 |
| Máximo de processos Chrome | 12 |
| RAM média / pico do container | 2081,08 / 2370,98 MiB |
| CPU média / pico do container | 98,93% / 380,10% |
| Node RSS médio / pico | 707,80 / 943,05 MiB |
| CPU por PID histórica | Não capturada; não pode ser reconstruída do RSS |

Top 5 processos Chrome por **pico de RSS**, em MiB (média apenas enquanto presentes):

| PID | RSS médio | RSS pico |
|---|---:|---:|
| 154 | 548,5 | 765,6 |
| 153 | 496,8 | 621,3 |
| 56 — browser principal | 432,7 | 437,6 |
| 218 | 198,3 | 260,8 |
| 146 | 226,4 | 228,2 |

Incluindo Node, seu pico de 943,05 MiB supera esses processos individuais. PIDs renderer não foram mapeados a providers na captura antiga. **Somar RSS duplica páginas compartilhadas**; não comparar soma com working set do container como se fossem a mesma métrica.

- Pico CPU às 00:20:38.410: bootstrap das duas páginas e detalhe Superbet concorrentes, após primeira listagem Superbet. Associação temporal, sem atribuição exclusiva.
- Pico RAM às 00:21:43.370: segunda tentativa Bet365 e detalhe Superbet; Betano já havia falhado. Não é evidência de uma única operação responsável.
- A execução incluiu quatro listagens Superbet e 68 detalhes, além dos browsers. Não era benchmark exclusivo de Bet365/Betano.
- PID principal Chrome 56 permaneceu estável; IDs das duas tabs também. Nenhum restart global nem tab temporária órfã observado.
- Houve três navegações de homepage por provider, com backoff, e retries auxiliares da SPA Betano. Não houve loop de restart de Chrome.
- Listeners CDP são removidos em `finally`; consent handlers usam `WeakSet<Page>`. Testes locais anteriores verificaram estabilidade em cinco ciclos. A captura real histórica não contém contagem por ciclo: não é prova absoluta de ausência de leak.
- Host Docker `aarch64`, imagem/Chrome `amd64`; nova inspeção confirma `/run/rosetta/rosetta`. Há tradução de arquitetura. Seu custo incremental não foi medido contra Linux amd64 nativo; não extrapolar essas porcentagens diretamente ao Railway.

## Nova falha de startup com perfil persistido

Uma tentativa diagnóstica com a imagem `6a04653c8389…` e o volume técnico anterior parou **antes de qualquer homepage**. O processo `xmessage` exibiu o aviso do próprio Chrome: perfil em uso pelo PID 56 no hostname antigo `3b0091301e9b`. O `SingletonLock` persistido aponta para `3b0091301e9b-56`.

O container antigo estava parado. O novo hostname difere; a recusa foi do lock do Chrome, não HTTP 403 nem Xvfb. Não foram apagados locks, copiados cookies ou alterado recovery. A tentativa foi encerrada. Isso demonstra um risco distinto de reutilização desse perfil entre containers e também limita a alegação anterior de shutdown completamente limpo do perfil. Não explica o alto consumo durante a execução original: então o Chrome estava funcionando.

## Conclusões e limites

**Acesso:** Betano falhou primeiro na API de bootstrap com 403; Bet365 falhou por ausência de feed após navegação. A regra que causa a recusa Betano e a causa interna da SPA Bet365 permanecem não demonstradas. O teste anterior 200 não contradiz esses resultados porque só cobria homepage.

**Recursos:** há custo relevante simultâneo de Node, subprocessos Chrome e trabalho Superbet; não múltiplos browsers ocultos. Imagem amd64 está sob Rosetta, e as SPAs executam carregamentos/retries. Não há evidência suficiente para declarar memory leak, listener leak ou atribuir todo o pico a uma dessas causas. Identificar a função responsável pelo custo Node exigiria profiling da mesma carga; os dados históricos não contêm CPU por PID. Nenhuma otimização foi aplicada.

Dados reproduzíveis: `evidence/homepage-matrix/results/`, `evidence/shared-browser/{samples.jsonl,resources.json,nest.log,targets-final.json,network/}`, e novo `evidence/access-resource-diagnostics/`. A nova sonda isola transporte, sem scheduler, parsers, publicação ou banco; seus números não substituem a medição completa acima.

## Nova captura por processo: transporte isolado

Janela 00:40:53.678–00:41:41.285 UTC, imagem `6a04653c8389…`, perfil técnico novo `/service/data/access-resource-fresh-profile`, mesmo Chrome Stable e rede Docker do runtime. Um browser, um contexto e duas tabs. Encerramento normal, exit 0, Xvfb encerrado. O perfil antigo não foi desbloqueado nem apagado.

Bet365: homepage 200, clique E-Sports concluído, timeout aguardando feed; nenhum HTTP >=400 e nenhum pageerror registrado. Betano: homepage 200, primeiro 403 às 00:41:22.237 em `/api/sportsbook-settings`, `server=cloudflare`, `content-type=text/html; charset=UTF-8`. Depois, timeout do clique eSports com `intercepts pointer events`; screenshot confirma modal promocional. Um SyntaxError `unexpected-token` apareceu depois do primeiro 403; não há stack suficiente para vincular causalmente os dois. Não foi fechado o modal para tentar reparar o fluxo, pois esta etapa é somente diagnóstico.

As duas falhas de feed também ocorrem sem scheduler, parser, banco ou coletas Superbet. Portanto esses componentes não são necessários para reproduzir a falha de acesso. Isso não identifica qual regra remota bloqueia a Betano.

Amostragem `/proc` a cada aproximadamente 1s: CPU por delta de utime+stime, CLK_TCK=100; 100%=um núcleo. Primeira observação de cada PID não tem delta. Tipos abaixo são os argumentos de processo observados: sob Rosetta/fork, `zygote` pode permanecer na linha de comando de descendentes; não é uma identificação CDP confiável do papel nem do provider. RSS não é PSS.

| PID | Tipo observado | RSS médio MiB | RSS pico MiB | CPU média % | CPU pico % |
|---|---|---:|---:|---:|---:|
| 133 | zygote | 389.40 | 786.57 | 32.46 | 195.61 |
| 134 | zygote | 516.01 | 609.68 | 16.59 | 142.71 |
| 37 | chrome | 409.49 | 430.58 | 9.04 | 114.66 |
| 126 | zygote | 223.91 | 229.19 | 2.43 | 73.93 |
| 25 | node | 190.09 | 204.22 | 4.57 | 25.48 |
| 194 | zygote | 147.99 | 195.09 | 8.37 | 57.88 |
| 70 | utility | 160.12 | 167.79 | 3.70 | 31.90 |
| 267 | utility | 94.85 | 95.20 | 0.00 | 0.00 |
| 250 | zygote | 94.91 | 95.08 | 0.05 | 1.00 |
| 266 | utility | 93.30 | 93.36 | 0.00 | 0.00 |
| 19 | Xvfb | 92.53 | 93.15 | 0.40 | 2.00 |
| 44 | zygote | 77.94 | 77.96 | 0.02 | 1.00 |
| 41 | zygote | 77.89 | 77.89 | 0.00 | 0.00 |
| 76 | zygote | 66.42 | 67.04 | 0.13 | 1.00 |
| 39 | chrome_crashpad | 6.71 | 6.71 | 0.00 | 0.00 |
| 43 | chrome_crashpad | 6.51 | 6.51 | 0.00 | 0.00 |
| 64 | chrome | 0.00 | 0.00 | 0.00 | 0.00 |

Máximo observado nesta sonda: 14 processos com nome Chrome, incluindo crashpad (a contagem histórica de 12 usa o monitor anterior e pode excluir auxiliares reparentados). Listeners da sonda: um response e um requestfailed por page, sem adição por polling. Não houve polling/restart/reload nesta sonda; não usar esse fato como teste de leak de longa duração.

Node isolado: 190,09 MiB RSS médio / 204,22 MiB pico; 4,57% CPU média / 25,48% pico. Contrasta com 707,80/943,05 MiB na aplicação completa, mas a carga e o estado são diferentes. Não subtrair essas medições como custo exato de PostgreSQL ou matching.

Picos por processo, com operação em andamento (correlação temporal; a tab Bet365 continua viva durante navegação Betano):

- PID 133: pico CPU 195.61% em 2026-09-15T00:41:24.771Z, `betano:esports-navigation`.
- PID 134: pico CPU 142.71% em 2026-09-15T00:40:58.685Z, `bet365:esports-navigation`.
- PID 37: pico CPU 114.66% em 2026-09-15T00:40:55.681Z, `bet365:homepage`.
- PID 126: pico CPU 73.93% em 2026-09-15T00:40:56.682Z, `bet365:esports-navigation`.
- PID 25: pico CPU 25.48% em 2026-09-15T00:41:41.285Z, `shutdown`.

Investigação complementar: [HTTP após bootstrap](HTTP_BOOTSTRAP_DIAGNOSTICS.md). A nova execução não obteve feeds funcionais no browser; portanto a transferência da sessão para HTTP e sua validade permanecem inconclusivas.
