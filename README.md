# ShareRoom

Aplicação web para compartilhar a tela entre navegadores usando WebRTC e WebSocket.

## Executar localmente
Requer Node.js 20 ou superior.
```bash
npm install
npm start
```
Acesse http://localhost:3000/?sala=rrzin em duas janelas. Para compartilhar, use Chrome ou Edge e autorize a captura de tela.

## Publicar
O serviço está preparado para deploy no Render: conecte este repositório como Web Service, com `npm install` no build e `npm start` no start. O Render fornece HTTPS.

## Limites importantes
A transmissão usa WebRTC com STUN público. Algumas redes exigem TURN para conectar. O anfitrião envia uma cópia do vídeo por espectador, então o upload aumenta com cada pessoa. Esta primeira versão não tem autenticação ou senha de sala; não compartilhe conteúdo sensível. Um serviço hospedado gratuito pode entrar em suspensão quando inativo.
