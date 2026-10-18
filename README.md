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

## Limites importantes

A transmissão usa WebRTC com STUN público e permite até três compartilhamentos simultâneos por sala. Algumas redes exigem TURN para conectar. Cada compartilhador envia vídeo diretamente a cada participante conectado, então o upload e o processamento aumentam conforme o número de pessoas e telas. Os perfis de qualidade ajustam a captura e o bitrate, mas a resolução/FPS efetivos dependem do navegador, hardware e conexão. A aplicação não tem autenticação ou senha de sala; não compartilhe conteúdo sensível. Um serviço hospedado gratuito pode entrar em suspensão quando inativo.