# ShareRoom

Aplicação web para compartilhar telas entre navegadores usando WebRTC e WebSocket. Cada sala aceita até três compartilhamentos de tela simultâneos.

## Executar localmente

Requer Node.js 20 ou superior.

```bash
npm install
npm start
```

Acesse http://localhost:3000/?sala=rrzin em duas janelas. Para compartilhar, use Chrome ou Edge e autorize a captura de tela.

## Publicar gratuitamente no Render

1. Entre em https://render.com/ e conecte sua conta GitHub.
2. Abra https://dashboard.render.com/select-repo?type=web e escolha o repositório `romulochulaboy-web/romulosite`.
3. Configure como **Web Service**, com **Build Command** `npm install` e **Start Command** `npm start`.
4. Selecione o plano Free e clique em **Deploy Web Service**. O Render fornecerá uma URL HTTPS ao concluir o deploy.
5. Teste a URL em dois dispositivos ou navegadores, usando o mesmo código de sala.

O arquivo `render.yaml` também contém a configuração básica do serviço.

## Otimizações de desempenho

- Compressão HTTP para HTML, CSS e JavaScript.
- Fontes do sistema para evitar requisições extras a serviços de terceiros.
- Monitoramento adaptativo do WebRTC com proteção contra ciclos de medição sobrepostos.
- Heartbeat WebSocket para remover conexões abandonadas e atualizar a presença da sala.
- Sinalização WebSocket sem compressão por mensagem, reduzindo trabalho extra em mensagens pequenas.

## Limites importantes

A transmissão usa WebRTC com STUN público e permite até três compartilhamentos simultâneos por sala. Algumas redes exigem TURN para conectar. Cada compartilhador envia vídeo diretamente a cada participante conectado, então o upload e o processamento aumentam conforme o número de pessoas e telas. Os perfis de qualidade ajustam a captura e o bitrate, mas a resolução/FPS efetivos dependem do navegador, hardware e conexão. A aplicação não tem autenticação ou senha de sala; não compartilhe conteúdo sensível. Um serviço hospedado gratuito pode entrar em suspensão quando inativo.

## Estabilidade de conexão (opcional)

O servidor disponibiliza `/rtc-config` e usa STUN por padrão. Para ajudar usuários atrás de NATs/firewalls restritivos, configure um serviço TURN no painel do Render com estas variáveis de ambiente:

- `TURN_URL`: URL(s) TURN, por exemplo `turn:turn.example.com:3478` (várias URLs separadas por vírgula).
- `TURN_USERNAME`: usuário TURN.
- `TURN_CREDENTIAL`: senha/credencial TURN.

Use credenciais de um provedor TURN confiável; não coloque senhas no código público. Sem TURN configurado, algumas redes ainda podem impedir a conexão direta.

A aplicação também ajusta o bitrate dinamicamente com base em perda de pacotes/latência e limita o orçamento total de upload por compartilhador para reduzir congelamentos quando há vários espectadores. Isso pode reduzir a nitidez em conexões lentas para favorecer a fluidez.
