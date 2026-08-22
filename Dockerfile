# --- Build do PWA ------------------------------------------------------------
FROM node:24-alpine AS construcao

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# As variáveis VITE_ são embutidas no bundle em tempo de build, não lidas em
# runtime. Por isso entram como argumentos: no EasyPanel, configure-as como
# "Build Arguments" do serviço, não como variáveis de ambiente.
ARG VITE_API_URL
ARG VITE_APP_VERSAO=0.1.0
ARG VITE_CHAVE_PUBLICA_ASSINATURA
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_VERSAO=$VITE_APP_VERSAO
ENV VITE_CHAVE_PUBLICA_ASSINATURA=$VITE_CHAVE_PUBLICA_ASSINATURA

RUN npm run build

# --- Serviço estático --------------------------------------------------------
FROM nginx:1.27-alpine

COPY --from=construcao /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
