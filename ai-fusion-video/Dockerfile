# ============================================
# 融光 - 后端 Dockerfile (多阶段构建)
# ============================================

# ---------- 阶段 1: 构建 ----------
FROM eclipse-temurin:21-jdk AS builder

WORKDIR /build

# 先复制 Maven Wrapper 和 pom.xml，利用 Docker 缓存加速依赖下载
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
# 兼容 Windows CRLF 行尾（即使不经过 Git checkout）
RUN sed -i 's/\r$//' mvnw && chmod +x mvnw
RUN --mount=type=cache,target=/root/.m2 ./mvnw dependency:go-offline -B

# 复制源码并打包
COPY src/ src/
RUN --mount=type=cache,target=/root/.m2 ./mvnw package -DskipTests -B

# ---------- 阶段 2: 拉取固定版本的 EasyColab 无头唤醒组件 ----------
FROM alpine/git:2.47.2 AS easycolab

ARG EASYCOLAB_REPO=https://github.com/wy51ai/easycolab.git
ARG EASYCOLAB_REF=fcad66f0d766194ad65ce1843bd624a43010721a

RUN git clone --filter=blob:none "$EASYCOLAB_REPO" /easycolab \
  && git -C /easycolab checkout "$EASYCOLAB_REF"

# ---------- 阶段 3: 运行 ----------
FROM eclipse-temurin:21-jre

LABEL maintainer="Stonewu <https://github.com/Stonewuu>"

WORKDIR /app

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

# 从构建阶段复制 JAR
COPY --from=builder /build/target/*.jar app.jar

# 创建数据目录
RUN mkdir -p /app/data/media /app/data/agent-workspace /app/data/easycolab

# 暴露端口
EXPOSE 18080

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:18080/v3/api-docs || exit 1

ENTRYPOINT ["java", "-jar", "app.jar"]
