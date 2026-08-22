# O Node 24 executa TypeScript direto, apagando os tipos em tempo de carga.
# Sem passo de build, a imagem fica menor e o que roda em produção é
# exatamente o arquivo que está no repositório — não um artefato intermediário.
FROM node:24-alpine

WORKDIR /app

# `dumb-init` para o contêiner encaminhar SIGTERM ao Node: sem isso o EasyPanel
# derruba o processo no meio de uma transação de sincronização.
RUN apk add --no-cache dumb-init

COPY servidor/package.json servidor/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY servidor/src ./src
# As migrations vivem fora do servidor porque também são usadas pela suíte de
# validação do repositório. A imagem leva uma cópia.
COPY banco/migrations ./banco/migrations

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# O healthcheck do EasyPanel usa esta rota para saber quando liberar tráfego.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.ts"]
