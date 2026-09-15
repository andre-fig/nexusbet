# NexusBet Collector Extension

Aplicativo de coleta separado de `apps/odds-monitor`. A extensão Chrome lê cinco providers de odds pré-jogo, normaliza as respostas no próprio navegador e envia publicações por HTTPS ao endpoint de ingestão do `odds-service` no Railway. O monitor continua apenas lendo REST/SSE; ele não participa da coleta.

Bet365 e Betano usam abas criadas pela extensão e `chrome.debugger` somente nessas abas. Superbet, Blaze e EstrelaBet usam `fetch` anônimo do service worker. A captura é somente leitura; não automatiza apostas, login, CAPTCHA ou 2FA. Cada provider mantém seu protocolo. Os parsers e contratos puros existentes em `apps/odds-service/src` são incorporados ao bundle durante o build; o runtime da extensão não importa Node, Nest, Prisma ou o monitor. Enquanto o collector-agent antigo ainda estiver ativo, **não ative esta extensão com credenciais de produção**: há apenas uma instância escritora.

## Build e testes

Use Node 24+ nesta pasta:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

O build produz `dist/`, ignorado pelo Git. Para validação local, carregue essa pasta no Chrome. Na máquina que atualiza pela main, o supervisor copia o bundle aprovado para `%LOCALAPPDATA%\NexusBet\collector-extension`; instale essa pasta estável uma vez para não perder o caminho a cada release. `private-config.json` e sua cópia em `dist/` também são ignorados. A extensão não armazena o token no IndexedDB; somente as publicações já sanitizadas entram na fila local. Um envio só sai da fila depois de resposta HTTP bem-sucedida. Falhas mantêm a captura para retry.

## Configuração

Crie `private-config.json` somente depois de parar a instância escritora antiga. Se o Chrome carregou a pasta estável, crie o arquivo nela; se carregou `dist/`, crie-o na raiz do projeto e rode o build para copiá-lo:

```json
{
  "serverUrl": "https://odds-service-production-f25c.up.railway.app/",
  "token": "TOKEN_DE_INGESTAO_PRIVADO"
}
```

Depois rode `npm run build`, abra `chrome://extensions`, habilite o modo de desenvolvedor e carregue `dist/` ou a pasta estável como extensão sem compactação. A permissão `debugger` será exibida pelo Chrome uma vez na instalação. O Chrome precisa estar aberto após o login do usuário. A extensão começa **pausada**. `Testar sem enviar` no popup captura e normaliza listagens e um detalhe por provider, mas não grava na outbox nem chama o Railway; pode ser executado enquanto o agent antigo trabalha. Após parar o agent antigo, adicione o arquivo privado e clique em `Ativar coleta` no popup. Essa escolha permanece no storage local do Chrome. O popup mostra a fila pendente e os estados por provider. O service worker usa `chrome.alarms` para acordar a cada 30 segundos, descobre eventos a cada 5 minutos por provider após uma listagem bem-sucedida e agenda detalhes por horário de início com backoff/cooldown. Os detalhes continuam com intervalos de 60/30/5/1 minutos conforme a proximidade do evento.

`build-id.txt` é um hash do bundle público. O supervisor continua verificando cada SHA da `main`, mas só troca os arquivos da extensão quando esse hash muda; commits em outras áreas não interrompem capturas no Chrome. A recarga automática foi observada nesta máquina. Para desligar o collector-agent no corte, defina `NEXUSBET_AGENT_ENABLED=false` no `agent.json` privado; o supervisor pede parada graciosa e mantém a atualização das releases. Os cinco providers já entregaram dados reais ao Railway nesta máquina, mas Bet365 apresentou respostas vazias intermitentes. Os testes offline cobrem parsers, detalhes, ingestão e estabilidade do ID de build; a coleta contínua ainda depende da disponibilidade dos feeds reais.
