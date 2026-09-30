ARG BUN_VERSION=1.3.14
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build && bun run notices

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home --shell /usr/sbin/nologin cstack \
    && mkdir /data && chown cstack:cstack /data && chmod 700 /data
COPY --from=build /build/dist/cstack /usr/local/bin/cstack
COPY --from=build /build/dist/THIRD_PARTY_NOTICES.txt /usr/share/doc/change-stack/THIRD_PARTY_NOTICES.txt
COPY README.md /usr/share/doc/change-stack/README.md
LABEL org.opencontainers.image.source="https://github.com/Neat-Snap/change-stack"
ENV CHANGE_STACK_CONFIG=/data/config.json
USER cstack
WORKDIR /data
EXPOSE 4317
ENTRYPOINT ["cstack", "--listen", "0.0.0.0", "--public-url", "http://127.0.0.1:4317", "--port", "4317", "--no-open"]
