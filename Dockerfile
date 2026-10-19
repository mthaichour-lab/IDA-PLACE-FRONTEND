# syntax=docker/dockerfile:1.7
# IDA Place — frontend Next.js (SEC-23).
#
# Image multi-étapes : dépendances -> build (configuration de production
# OBLIGATOIRE, contrôlée par config/build-env.ts) -> exécution minimale
# (`output: 'standalone'`), sans sources, sans source maps, sans dépendances
# de développement, utilisateur non-root.
#
# Les variables NEXT_PUBLIC_* sont inlinées AU BUILD : une image est propre à
# un environnement (URL de l'API et de Keycloak).
#   docker build \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.exemple.dz \
#     --build-arg NEXT_PUBLIC_KEYCLOAK_URL=https://auth.exemple.dz \
#     -t ida-place-frontend .
#
# En production, épingler l'image de base par empreinte (node:22-alpine@sha256:…).
ARG NODE_IMAGE=node:22-alpine

# ---------- 1. Dépendances (toutes, pour le build) ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts : aucun script d'installation tiers exécuté.
RUN npm ci --ignore-scripts --no-audit --no-fund

# ---------- 2. Build de production ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_KEYCLOAK_URL
ARG NEXT_PUBLIC_KEYCLOAK_REALM=ida-place
ARG NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=ida-place-web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_AUTH_MODE=keycloak \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_KEYCLOAK_URL=${NEXT_PUBLIC_KEYCLOAK_URL} \
    NEXT_PUBLIC_KEYCLOAK_REALM=${NEXT_PUBLIC_KEYCLOAK_REALM} \
    NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=${NEXT_PUBLIC_KEYCLOAK_CLIENT_ID}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `next build` échoue si la configuration n'est pas une configuration de
# production sûre ; puis contrôle que le mode d'authentification de
# développement n'a pas été livré.
RUN npm run build \
 && if grep -rl "x-dev-user" .next/; then echo "ERREUR : x-dev-user présent dans le build" >&2; exit 1; fi \
 && if find .next -name "*.map" | grep -q .; then echo "ERREUR : source maps présentes" >&2; exit 1; fi

# ---------- 3. Exécution ----------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 nextjs && adduser -S -u 1001 -G nextjs nextjs \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
# Page technique sans donnée ni appel API (retour de déconnexion).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/auth/logged-out').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
