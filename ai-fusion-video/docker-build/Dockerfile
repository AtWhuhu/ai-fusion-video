# CI 发布镜像（docker-publish.yml）使用的 Dockerfile，JAR 由 CI 预先构建；运行阶段需与 ../Dockerfile 保持一致

# ---------- 阶段 1: 拉取固定版本的 EasyColab 无头唤醒组件 ----------
FROM alpine/git:2.47.2 AS easycolab

ARG EASYCOLAB_REPO=https://github.com/wy51ai/easycolab.git
ARG EASYCOLAB_REF=fcad66f0d766194ad65ce1843bd624a43010721a

RUN git clone --filter=blob:none "$EASYCOLAB_REPO" /easycolab \
  && git -C /easycolab checkout "$EASYCOLAB_REF"

# ---------- 阶段 2: 运行 ----------
FROM eclipse-temurin:21-jre

LABEL maintainer="Stonewu <https://github.com/Stonewuu>"

WORKDIR /app

ENV SPRING_PROFILES_ACTIVE=docker

RUN set -eux; \
  if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then \
    sed -i 's|http://archive.ubuntu.com/ubuntu/|https://archive.ubuntu.com/ubuntu/|g; s|http://security.ubuntu.com/ubuntu/|https://security.ubuntu.com/ubuntu/|g' /etc/apt/sources.list.d/ubuntu.sources; \
  fi; \
  if [ -f /etc/apt/sources.list ]; then \
    sed -i 's|http://archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g; s|http://security.ubuntu.com/ubuntu|https://security.ubuntu.com/ubuntu|g' /etc/apt/sources.list; \
  fi; \
  apt-get update -o Acquire::Retries=5; \
  apt-get install -y --no-install-recommends ffmpeg curl python3 python3-venv; \
  rm -rf /var/lib/apt/lists/*

# EasyColab：colab_bridge.py 在本机调用 Google Colab API 唤醒 GPU 并上传 app.py / runtime_auth.py
# google-colab-cli 0.7.6 起移除了 colab_bridge.py 依赖的 TOKEN_CONFIG_PATH，固定 0.7.5
COPY --from=easycolab /easycolab/colab_bridge.py /easycolab/app.py /easycolab/runtime_auth.py /easycolab/requirements.txt /opt/easycolab/
RUN python3 -m venv /opt/easycolab/venv \
  && /opt/easycolab/venv/bin/pip install --no-cache-dir -r /opt/easycolab/requirements.txt "google-colab-cli==0.7.5"

COPY app.jar app.jar

RUN mkdir -p /app/data/media /app/data/agent-workspace /app/data/easycolab

EXPOSE 18080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:18080/v3/api-docs || exit 1

ENTRYPOINT ["java", "-jar", "app.jar"]
