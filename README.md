# GuiRepo TV & Esportes BR — Addon Stremio / NuvioTV

Addon unificado de **TV ao Vivo e Agenda Esportiva** no padrão Stremio, compatível com **NuvioTV**, **Nuvio Mobile/Smart TV** e **Stremio**.

Agrega em tempo real as 4 fontes de TV ao Vivo do `guirepo`:
- **BRFlix TV** (canais + agenda esportiva)
- **EmbedTV** (canais + jogos/eventos)
- **TV a Cabo** (canais + jogos do dia)
- **Rei dos Embeds** (canais + agenda esportiva)

Cada canal é deduplicado automaticamente: ao abrir um canal (ex.: `SporTV`, `ESPN`, `Globo`, `Premiere`), o addon consulta todas as fontes em paralelo e entrega múltiplos servidores de backup na mesma tela.

## Rodar localmente (Node.js 18+)

```bash
node server.mjs
```

Manifesto disponível em:
- No PC: `http://127.0.0.1:7000/manifest.json`
- Na rede local (Android TV / celular no mesmo Wi-Fi): `http://<IP-DO-PC>:7000/manifest.json`
- No emulador MuMu (com `adb reverse tcp:7000 tcp:7000`): `http://127.0.0.1:7000/manifest.json`

## Teste rápido

```bash
npm test
```

## Deploy gratuito no Cloudflare Workers (para usar 24h sem o PC ligado)

```bash
npx wrangler deploy
```

Depois, adicione `https://<seu-worker>.workers.dev/manifest.json` na aba **Addons** do NuvioTV.


## Integração Xtream Codes (Max Play)

A integração Xtream é opcional e fica desativada até que as três variáveis privadas sejam configuradas no Render. Não coloque credenciais em arquivos versionados.

Configure no serviço Render `maxplay-guirepo`:

- `XTREAM_BASE_URL` — URL do servidor do provedor, incluindo protocolo e porta se necessário.
- `XTREAM_USERNAME` — usuário fornecido pelo provedor.
- `XTREAM_PASSWORD` — senha fornecida pelo provedor.

Rotas do catálogo (JSON):

- `GET /api/xtream/status` — informa somente se a integração está configurada.
- `GET /api/xtream/live/categories` e `/api/xtream/live/streams`
- `GET /api/xtream/vod/categories` e `/api/xtream/vod/streams`
- `GET /api/xtream/series/categories` e `/api/xtream/series/list`
- Listagens aceitam `?category_id=ID` e `?q=termo` (ou `?search=termo`).
- `GET /api/xtream/series/info/ID` — informações da série, temporadas e episódios fornecidos pelo provedor.
- `GET /api/xtream/play/live/ID`, `/movie/ID` e `/episode/ID` — URL local de reprodução.
- `GET /api/xtream/proxy?ref=...` — proxy de mídia/HLS com referência temporária opaca.

A senha nunca é devolvida pela API de status, catálogo ou reprodução. O proxy mantém as URLs do provedor no servidor e reescreve playlists HLS para usar o próprio backend. A reprodução automática e a interface visual dependem do aplicativo cliente que consome estas rotas; este repositório é um backend/addon, não o código da interface nativa do Max Play.

Teste determinístico da integração: `npm test`. O teste externo dos provedores preexistentes pode ser executado separadamente com `npm run test:providers` e depende da disponibilidade dos sites terceiros.
