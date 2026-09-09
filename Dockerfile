# =============================================================================
# GRISOMAQ CONTROLE — imagem única para produção (EasyPanel).
#
# Contém o PWA construído e o servidor Fastify que serve tanto os arquivos
# estáticos quanto a API, no MESMO endereço. Sem CORS, sem porta separada, um
# único domínio HTTPS — que é o formato mais simples para publicar num túnel
# do EasyPanel.
#
# Multi-stage porque:
#   - o build precisa de todas as devDependências (Vite, TypeScript, etc);
#   - a imagem final leva só o resultado, sem essas dependências.
#
#   docker build -t grisomaq .
#   docker run -p 3000:3000 --env-file .env grisomaq
# =============================================================================

# --- Stage 1: build do PWA --------------------------------------------------
FROM node:24-alpine AS pwa

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# As variáveis VITE_ são embutidas no bundle em tempo de build, não em runtime.
# No EasyPanel isso vira "Build Arguments" do serviço.
#
# Para deploy MESMA ORIGEM (recomendado): passar VITE_API_URL="" — o cliente
# usa caminhos relativos e nunca precisa saber o domínio.
ARG VITE_API_URL=""
ARG VITE_APP_VERSAO=0.1.0
ARG VITE_CHAVE_PUBLICA_ASSINATURA=""
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_VERSAO=$VITE_APP_VERSAO
ENV VITE_CHAVE_PUBLICA_ASSINATURA=$VITE_CHAVE_PUBLICA_ASSINATURA

RUN npm run build


# --- Stage 2: imagem final --------------------------------------------------
FROM node:24-alpine

WORKDIR /app

# dumb-init encaminha SIGTERM ao Node — sem isso o EasyPanel derruba o processo
# no meio de uma transação de sincronização.
RUN apk add --no-cache dumb-init

# Só as dependências de produção do servidor.
COPY servidor/package.json servidor/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# Código do servidor e migrações — o layout dentro do container espelha o do
# repositório porque `migracoes.ts` calcula o caminho da pasta de migrations
# como `../../banco/migrations` a partir do arquivo. Achatar `servidor/src`
# em `/app/src` faz esse relativo cair em `/banco/migrations` e o boot falha.
COPY servidor/src ./servidor/src
COPY banco/migrations ./banco/migrations

# PWA construído do stage anterior. O servir-estatico.ts entrega estes arquivos.
COPY --from=pwa /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3000
ENV SERVIR_DIST=1
ENV DIST_DIR=/app/dist

EXPOSE 3000

# Rota de saúde usada pelo healthcheck do EasyPanel para liberar tráfego.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "servidor/src/index.ts"]
