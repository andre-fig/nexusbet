# HTTP após bootstrap legítimo do browser

## Escopo e critério

Teste de viabilidade, não implementação de transporte novo. Nenhum parser, matching, scheduler, banco ou snapshot foi alterado. Perfis técnicos próprios, Chrome Stable headed Linux/Xvfb, sem login, cookies pessoais, geração de tokens ou reprodução de challenges.

Para demonstrar que browser só é necessário no bootstrap, é necessário primeiro obter **listagem e detalhe válidos no browser na mesma execução**, depois validar os corpos equivalentes no cliente HTTP, fechar o browser e observar a sessão em cadência normal até expiração ou término da janela. HTTP 200 de homepage não satisfaz esse requisito. Um 403 isolado em HTTP tampouco demonstra token ligado ao browser.

A sonda usa os collectors e parsers existentes para validar a captura; `publications: []` impede publicação. Só uma coleta válida habilita comparação HTTP. O cliente HTTP previsto é `BrowserContext.request` do Playwright, que faz HTTP fora da página e compartilha o cookie jar técnico. Ele não é prova de independência do contexto: se funcionar, a etapa seguinte deve testar cliente separado após encerramento do browser. Não se deve chamar isso de sessão HTTP independente antes dessa etapa.

## Contexto conhecido, sem inferir necessidade

| Elemento | Bet365 | Betano |
|---|---|---|
| Listagem histórica | GET `/contentdata/othersportsmatchmarketscontentapi/list` | GET `/api/sport/esports/competicoes/<modalidade>/<regionId>/` |
| Detalhe histórico | GET `/contentdata/othersportsmatchbettingcontentapi/coupon` | GET `/api/odds/<slug>/<eventId>/` |
| Query observada | `lid`, `zid`, `pd`, `cid`, `cgid`, `ctid` | `req`; `sl` na seleção de competição |
| Estado de navegação | `PA.PD` da listagem; FI não equivale ao componente E da rota; abas podem alterar PD | Região/competição selecionada e link de evento fornecidos pela SPA |
| Cookies técnicos já observados | `__cf_bm`, `aps03`, `pers`, `pstk`, `rmbs`, `swt`, `ctc` | `_cfuvid`, `cf_clearance`, `sticky_sb`, consentimento e ageVerificationModal |
| Token necessário ao feed | Não demonstrado | Não demonstrado |
| Cookie/header mínimo suficiente | Não demonstrado | Não demonstrado |
| Vínculo criptográfico/TLS/browser | Não demonstrado | Não demonstrado |

Os nomes de cookies não provam sua função ou necessidade. Nenhum valor foi exportado. `cf_clearance` não é gerado, editado ou reproduzido como técnica de contorno. A lista histórica de parâmetros também não é um conjunto mínimo comprovado. Não se fez remoção/recombinação agressiva de headers, imitação TLS, alteração de User-Agent ou tentativa de contornar recusa.

Referência dos protocolos: [protocols.md](../apps/odds-service/docs/protocols.md). Referência das falhas anteriores: [ACCESS_RESOURCE_DIAGNOSTICS.md](ACCESS_RESOURCE_DIAGNOSTICS.md).

## Evidência da execução

Sonda local em `apps/odds-service/evidence/http-bootstrap/probe.mjs`; resultados sanitizados em `result.json`. Valores de cookies/headers e payloads de autenticação não são gravados no resultado. Headers são registrados por nome; somente `server`, `content-type`, `cf-mitigated` e `cf-cache-status` têm valores permitidos. As capturas completas permanecem evidência local ignorada pelo Git.

Chrome compartilhado com tabs fixas, perfil técnico novo `/service/data/http-bootstrap-profile`, imagem `odds-service-shared`, rede Docker `odds-service_default`. Teste limitado ao primeiro esporte (CS2) e interrompido por provider se a listagem não for válida; não tentar detalhe sem evento válido, nem URL histórica com ID adivinhado. Não há polling de renovação de sessão sem a pré-condição de feed funcional.

## Resultado real — 15/09/2026, 00:44:44–00:45:40 UTC

| Critério | Bet365 | Betano |
|---|---|---|
| Homepage | 200, 00:44:46.499 | 200, 00:45:11.979 |
| Primeiro erro HTTP observado | Nenhum >=400 no domínio durante a sonda | GET `/api/sportsbook-settings`: 403 às 00:45:14.979 |
| Erro da coleta | ProviderTransportError, feed indisponível | TimeoutError, navegação/listagem não concluída |
| Listagem funcional capturada | Não | Não |
| Detalhe funcional capturado | Não; sem evento válido para navegar | Não; sem evento válido para navegar |
| Tentativas HTTP após feed validado | **0 — pré-condição não satisfeita** | **0 — pré-condição não satisfeita** |
| Browser necessário continuamente | INCONCLUSIVO | INCONCLUSIVO |
| HTTP após bootstrap | NÃO validado | NÃO validado |
| Validade da sessão HTTP | Não mensurável | Não mensurável |

URLs finais: raízes `https://www.bet365.bet.br/` e `https://www.betano.bet.br/` (fragmentos não exportados). Títulos normais: `bet365 - Apostas Esportivas Online` e `Aposta Esportiva - Casa de Apostas Esportivas Online | Betano`.

A request Betano recusada **já enviava `cookie`**, `referer`, `user-agent`, `accept`, `accept-language`, `sec-ch-ua*`, `sec-fetch-*` e `x-kbversion`. Isso comprova presença desses elementos, não suficiência, validade, necessidade ou vínculo ao browser. Não foi uma request de odds funcional. A resposta tinha `server=cloudflare` e `content-type=text/html; charset=UTF-8`; não se conhece a regra do servidor responsável pelo 403. Os valores dos headers não foram copiados para cliente HTTP.

`SESSION VALIDITY`: nenhuma janela de sessão HTTP de odds estabelecida; não confundir duração do teste (~57s) com validade de sessão. Não foram medidos TTL de token/cookie ou renovação.

`FIRST HTTP FAILURE`: no **browser**, Betano 403 na API de configurações, antes de listagem/detalhe. No **cliente HTTP pós-bootstrap**, não há falha observada porque ele não foi acionado. Bet365 não forneceu request de feed para comparar.

Conclusão: a pré-condição falhou nos dois providers. Não há evidência para afirmar que HTTP com sessão técnica funciona, tampouco para afirmar que exige browser continuamente. O próximo passo depende de um feed funcional no browser; não é justificado escolher headers aleatórios, reaproveitar tokens históricos ou inferir URLs de detalhe para contornar a ausência desse controle.

O container terminou com exit 0 após registrar as falhas dos providers; Chrome e Xvfb foram encerrados. Nenhuma publicação foi executada. Apenas documentação e sonda diagnóstica local foram acrescentadas nesta tarefa.
