> **Histórico para Bet365/Betano:** a estratégia Linux/Xvfb/Chrome próprio foi abandonada nesta etapa. O runtime atual usa [Local CDP no Mac](LOCAL_CDP.md). Configure BET365_ENABLED=false, BETANO_ENABLED=false e BROWSER_RUNTIME=disabled em Railway. Os resultados e detalhes anteriores abaixo são preservados como histórico, não suporte atual.

> **Arquitetura atual:** um único Chrome/contexto compartilhado, tabs fixas por provider de browser. Ver [SHARED_BROWSER](SHARED_BROWSER.md). Os resultados anteriores no final deste arquivo são históricos, de antes dessa mudança.

# Produção: Linux, Xvfb e Chrome headed

O `odds-service` executa Chrome Stable normal dentro de um display virtual. Xvfb não é modo headless: `launchPersistentContext` recebe `headless: false`, User-Agent natural e os mesmos parsers/transports. Não há fallback headless, cópia de perfil pessoal ou contorno de proteção. A matriz histórica de homepages está em [HEADLESS_DIAGNOSTICS](HEADLESS_DIAGNOSTICS.md).

## Processo e dados

```text
container Linux amd64
  tini (PID 1: sinais/reaping)
    runtime/entrypoint.sh
      Xvfb :99 (1440x900x24, sem TCP)
      node dist/main.js
        Nest → scheduler existente → providers
          BrowserManagerService → um Chrome/contexto persistente
            Bet365 → tab fixa + sessão CDP
            Betano → tab fixa + sessão CDP
          Superbet → HTTP
        PostgreSQL + journals/checkpoints existentes
```

O entrypoint prepara o volume e abandona root via gosu antes de iniciar Xvfb/Nest/Chrome. O browser é reutilizado pelo gerenciador central, não criado por provider ou evento. As falhas continuam no recovery/backoff/circuit breaker existentes, sem mudar de modo. Playwright mantém seus indicadores/defaults de automação; recursos, service workers e storage continuam habilitados.

Todos os diretórios graváveis da imagem ficam em `/service/data`: `chrome-profile/`, captures, evidence, inboxes e journals. Monte volume persistente nesse caminho. Não compartilhe o mesmo profile entre processos/containers simultâneos; use uma única instância escritora. PostgreSQL continua separado. O build ignora `.env`, credentials, profiles, capturas e evidências locais.

O entrypoint cria apenas o diretório raiz gravável e ajusta seu proprietário. Um volume importado de outro UID pode exigir ajuste manual de permissões antes do deploy; não há chown recursivo nem exclusão automática de profiles/locks. Não remova um lock sem verificar se outro Chrome ainda usa o perfil.

## Desenvolvimento com o runtime real

Execute em `apps/odds-service`, após configurar `.env` conforme `.env.example`:

```sh
# Requer Docker; no Mac ARM, amd64 roda sob emulação.
docker compose up -d postgres
docker compose -f docker-compose.yml -f docker-compose.runtime.yml build odds-service
docker compose -f docker-compose.yml -f docker-compose.runtime.yml run --rm odds-service npm run db:migrate
docker compose -f docker-compose.yml -f docker-compose.runtime.yml up -d odds-service
curl http://127.0.0.1:3650/health
docker compose -f docker-compose.yml -f docker-compose.runtime.yml logs -f odds-service
# Encerra o polling; conserva volumes e PostgreSQL.
docker compose -f docker-compose.yml -f docker-compose.runtime.yml stop odds-service
```

O overlay usa o PostgreSQL existente; não cria outro banco/serviço distribuído. Sua URL interpolada é destinada ao ambiente local de exemplo. Se a senha contiver caracteres reservados em URL, forneça `DATABASE_URL` corretamente codificada em uma configuração local não versionada. Não use `down -v` para encerrar: apagaria dados.

Para um build isolado: `docker build --platform linux/amd64 -t odds-service:local .`. Chrome Stable é instalado do pacote oficial Google durante o build. Registre versão/digest da imagem promovida; um novo build pode receber uma versão Stable diferente. Não há download de browser nem `npm install` no startup. Prisma é gerado no build com OpenSSL do Debian; o CLI é mantido na imagem para migrations. A imagem contém ferramentas de build npm por simplicidade, mas o servidor roda JavaScript compilado. Scripts que precisam de `src` são para desenvolvimento; no runtime use `node dist/...`.

## Railway

Imagem Docker preparada; **não equivale a deploy remoto validado**. Configure os campos abaixo no serviço Railway. Não foi adicionado `railway.toml`: a documentação atual informa que novos serviços não podem adotar esse mecanismo legado. [Configuração Railway](https://docs.railway.com/config-as-code).

1. Configure root directory `/apps/odds-service`, Dockerfile `Dockerfile` (detectado automaticamente dentro desse root). Não use o frontend como root.
2. Conecte `DATABASE_URL` ao PostgreSQL do ambiente e defina `PERSISTENCE_MODE=postgres`. Pre-deploy: `npm run db:migrate` no campo Pre-deploy Command. O Nest verifica checksums/migrations no startup e restaura o estado antes de coletar. O seed de providers existente permanece idempotente.
3. Monte um volume em `/service/data`. Configure uma réplica e desative autoscaling/sleep para coleta contínua. Não execute dois deployments escritores ao mesmo tempo; com volume único aceite a interrupção de deploy necessária à exclusividade.
4. Defina `COLLECTION_ENABLED=true`, `BROWSER_MODE=headed`, `DISPLAY=:99`, `SHUTDOWN_GRACE_MS=30000`, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=90`, `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=0`. O restante dos defaults já está no Dockerfile; não defina start command que substitua o supervisor. `$PORT` é respeitado; `HOST=0.0.0.0` na imagem.
5. Healthcheck `/health`, timeout 120s, restart On Failure com até três tentativas. O código 200 verifica resposta da aplicação; leia o JSON para disponibilidade/stale de cada provider. Um provider bloqueado pode coexistir com API saudável.
6. Mantenha a API na rede privada. Ela não tem autenticação pública. Valide feeds na região/IP do deploy: sucesso no Docker local não prova disponibilidade remota.

O pre-deploy Railway não tem volume montado; por isso executa apenas migrations SQL. Os profiles são inicializados no processo normal. Configure explicitamente draining: o encerramento padrão da plataforma não oferece o prazo necessário. Referências oficiais: [pre-deploy](https://docs.railway.com/deployments/pre-deploy-command), [teardown](https://docs.railway.com/deployments/deployment-teardown), [referência de deployments](https://docs.railway.com/deployments/reference).

## Shutdown e falhas

SIGTERM/SIGINT chega pelo tini ao supervisor. Ele envia SIGTERM apenas ao Node, mantém Xvfb ativo e espera. Nest interrompe timers, drena jobs, aborta operações após `SHUTDOWN_GRACE_MS` quando aplicável, preserva commits iniciados, fecha transports/Chrome e desconecta o banco. Só depois o supervisor encerra/recolhe Xvfb. Se Xvfb morrer inesperadamente, o supervisor sinaliza Node, espera sua drenagem e retorna erro para o runtime reiniciar.

Não há kill interno de commits por prazo arbitrário. O prazo externo (Compose 90s/Railway draining configurado) é o limite final: um SIGKILL da plataforma continua podendo interromper o processo. Nenhum runtime garante graceful shutdown após SIGKILL, falha do host ou perda de energia. Configure margem acima de drenagem, transações e fechamento do browser.

## Verificação e evidências

Testes sem internet cobrem rejeição de headless em produção, ordem do shutdown e falha do display, além de reuse/configuração e suíte existente. Os testes locais opcionais de browser usam headed quando `DISPLAY` existe; verificam cinco ciclos de storage/cache/SW/WebSocket sem bookmaker. Rodá-los fora do container não comprova disponibilidade dos sites.

A validação remota deve registrar, por provider: homepage, listagem CS2/LoL/Valorant, detalhe, cinco ciclos completos, mesmos PIDs/contextos enquanto saudáveis, estado de snapshots e `/health`. Conte tentativas/falhas separadamente de ciclos bem-sucedidos. Não publique corpo vazio como atualização válida.

As medições do container incluem Nest, Chrome e Xvfb, excluem PostgreSQL e usam memória working-set/CPU de `docker stats`; CPU 100% corresponde a um core. Emulação amd64 em Mac ARM não é benchmark de capacidade de um servidor amd64 nativo. Não há dimensionamento universal de RAM/CPU: depende de páginas, catálogo e região. Monitore volume também: não foi criada política nova de retenção.

## Resultado histórico antes do browser compartilhado

Validação em 14/09/2026 23:58–23:59 UTC, Docker Linux amd64 emulado em Mac ARM. Chrome **153.0.8010.36**, `/opt/google/chrome/chrome`; Node **22.23.2**, Playwright **1.63.0**, CDP **1.3**. `headless:false`, `DISPLAY=:99`, nenhuma flag headless na linha observada. Um contexto/page por provider durante a tentativa; após falha, o recovery existente pode fechar/reabrir o contexto no mesmo diretório.

| Verificação | Resultado |
|---|---|
| Xvfb + Chrome headed + Nest compilado | OK |
| Migration dentro da imagem / PostgreSQL / health | OK |
| Bet365 homepage | 200 |
| Betano homepage inicial | 200 |
| Betano reabertura do perfil | 403; probe interrompido na homepage |
| Bet365 listagem | Não validada: após clicar consentimento e E-Sports, nenhuma requisição `/contentdata/` em 30s; painel central vazio |
| Betano listagem | Não validada: primeiro fluxo parou na navegação com modal promocional; APIs auxiliares da SPA também retornaram 403 |
| CS2 / LoL / Valorant e detalhe por provider | Não validados; nenhum ciclo completo de listagem passou. Não contamos modalidades não alcançadas como testadas com sucesso |
| Cinco ciclos reais Bet365 / Betano | **NÃO — 0/5 completos em cada provider** |
| Cinco ciclos locais de Chrome/storage/SW/WebSocket no Xvfb | OK, teste sem bookmaker |
| Graceful shutdown real | OK: três jobs ativos no SIGTERM, scheduler drenado para zero, Node exit 0 antes de Xvfb parar; sem OOM/SIGKILL |
| Deploy Railway | Não executado; imagem preparada, disponibilidade dos feeds pendente |

A homepage 200 não comprovou funcionamento de eSports. Na Betano, respostas 403 apareceram em requests normais como `/api/v1/translations/kcv/sportsbookbetting/pt_BR/24/` e `/api/sportsbook-settings`; posteriormente até a homepage voltou a 403. Não foi tentado contorno, login, troca de identidade ou headless. Na Bet365, mesmo consentimento normal seguido do clique em E-Sports não produziu feed. Não houve mudança de parser para mascarar esses resultados.

O scheduler fez duas tentativas por provider; a segunda Bet365 foi drenada/abortada no shutdown. Não insistimos até cinco falhas para simular cinco ciclos. Como controle da persistência e isolamento, Superbet concluiu duas listagens (86 eventos) e 31 detalhes. O banco isolado ficou com **86 provider_events, 1.036 markets e 3.013 odds_snapshots**. Reiniciar com coleta desabilitada restaurou 86 eventos conhecidos, conexão PostgreSQL e as mesmas contagens. O volume técnico e os dados anteriores do usuário foram preservados.

### Recursos observados

Janela de aproximadamente 112s, incluindo startup, falhas, backoff e shutdown. Média aritmética das observações com memória não zero do Docker CLI; o stream pode repetir medições entre refreshes. Valores aproximados, **não representam cinco ciclos bem-sucedidos** nem capacidade de produção nativa.

| Métrica (container inteiro, sem PostgreSQL) | Valor |
|---|---:|
| RAM média working-set | 1.145 MiB |
| RAM pico amostrado | 2.685 MiB |
| CPU média | 136,2% (1,36 cores) |
| CPU pico amostrado | 792,3% (7,92 cores) |
| Processos `chrome` simultâneos observados | máximo 19, incluindo renderers/zygotes/utilitários; não são 19 browsers |
| Tempo médio de coleta válida Bet365/Betano | Indisponível: nenhuma listagem válida |
| Drenagem no shutdown real | cerca de 31s |

A RAM/CPU elevadas incluem inicialização de dois browsers e emulação amd64. O período é curto e teve falhas; não permite concluir ausência de memory leak. As evidências locais ignoradas estão em `apps/odds-service/evidence/runtime-xvfb/`: `resources.json`, `health-processes.jsonl`, `nest.log`, `restart-health.json`, screenshots/metadados em `complete-attempt/` e `navigation-probe/`. Não versionar profiles ou valores de cookies.

Build, typecheck e format:check passaram. Suíte normal no Mac: 96 passaram, três browser tests opcionais pulados; suíte Linux/Xvfb com browser tests locais: **99/99**; PostgreSQL em banco descartável: **23/23**. Containers de coleta/probes/testes foram encerrados; apenas o PostgreSQL preexistente ficou ativo.

**Conclusão:** runtime Docker/Xvfb implementado e testado; ainda não pronto como coleta autônoma validada de Bet365 e Betano no Railway. O impedimento restante é obter os feeds pelo frontend normal, não inicializar o display/browser. Não anunciar o serviço como operacional com base somente nas homepages 200.
