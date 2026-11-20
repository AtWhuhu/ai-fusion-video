package com.stonewu.fusion.service.system;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.stonewu.fusion.controller.system.vo.RuntimeVersionInfoRespVO;
import com.stonewu.fusion.controller.system.vo.VersionInfoRespVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.springframework.boot.info.BuildProperties;
import org.springframework.core.env.Environment;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 版本检查服务
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class VersionCheckService {

    private static final String TAGS_API_URL =
            "https://api.github.com/repos/AtWhuhu/ai-fusion-video/tags?per_page=100";
    private static final String RELEASES_PAGE_URL =
            "https://github.com/AtWhuhu/ai-fusion-video/tags";
    private static final String GHCR_TOKEN_URL_TEMPLATE =
            "https://ghcr.io/token?scope=repository:%s:pull&service=ghcr.io";
    private static final String GHCR_MANIFEST_URL_TEMPLATE = "https://ghcr.io/v2/%s/manifests/%s";
    private static final String GHCR_MANIFEST_ACCEPT = String.join(", ",
            "application/vnd.oci.image.index.v1+json",
            "application/vnd.docker.distribution.manifest.list.v2+json",
            "application/vnd.oci.image.manifest.v1+json",
            "application/vnd.docker.distribution.manifest.v2+json");
    private static final String BACKEND_IMAGE_REPOSITORY = "atwhuhu/ai-fusion-video";
    private static final String FRONTEND_IMAGE_REPOSITORY = "atwhuhu/ai-fusion-video-web";
    private static final int MAX_IMAGE_CHECKS = 10;
    private static final Duration CACHE_TTL = Duration.ofHours(6);
    private static final Pattern SEMVER_PATTERN =
            Pattern.compile("(\\d+)(?:\\.(\\d+))?(?:\\.(\\d+))?(?:-fork\\.(\\d+))?");
    private static final Pattern RELEASE_TAG_PATTERN = Pattern.compile("^v?\\d+\\.\\d+\\.\\d+(?:-fork\\.\\d+)?$");
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @Nullable
    private final BuildProperties buildProperties;

    private final Environment environment;

    private final OkHttpClient httpClient = new OkHttpClient.Builder()
            .connectTimeout(1, TimeUnit.MINUTES)
            .readTimeout(25, TimeUnit.MINUTES)
            .callTimeout(25, TimeUnit.MINUTES)
            .build();

    private volatile CachedVersionInfo cachedVersionInfo;

    public RuntimeVersionInfoRespVO getRuntimeVersionInfo() {
        return toRuntimeResp(resolveRuntimeVersionInfo());
    }

    public VersionInfoRespVO getVersionInfo(boolean forceRefresh) {
        RuntimeVersionInfo runtimeVersionInfo = resolveRuntimeVersionInfo();

        CachedVersionInfo snapshot = cachedVersionInfo;
        if (!forceRefresh && snapshot != null && !snapshot.isExpired()) {
            return toResp(runtimeVersionInfo, snapshot);
        }

        synchronized (this) {
            snapshot = cachedVersionInfo;
            if (!forceRefresh && snapshot != null && !snapshot.isExpired()) {
                return toResp(runtimeVersionInfo, snapshot);
            }

            CachedVersionInfo refreshed = fetchLatestVersionInfo();
            cachedVersionInfo = refreshed;
            return toResp(runtimeVersionInfo, refreshed);
        }
    }

    private VersionInfoRespVO toResp(RuntimeVersionInfo runtimeVersionInfo, CachedVersionInfo latest) {
        ReleaseInfo deployableRelease = latest.deployableRelease();
        ReleaseInfo latestRelease = latest.latestRelease();
        boolean comparisonEnabled = latest.checkSucceeded()
                && runtimeVersionInfo.comparisonEnabled()
                && deployableRelease != null
                && hasText(deployableRelease.version());
        String versionRelation = resolveVersionRelation(
                runtimeVersionInfo.currentVersion(),
                deployableRelease != null ? deployableRelease.version() : null,
                comparisonEnabled
        );

        VersionInfoRespVO respVO = new VersionInfoRespVO();
        respVO.setCurrentVersion(runtimeVersionInfo.currentVersion());
        respVO.setCurrentVersionDisplay(runtimeVersionInfo.currentVersionDisplay());
        respVO.setLatestVersion(deployableRelease != null ? deployableRelease.version() : null);
        respVO.setLatestVersionDisplay(displayVersion(deployableRelease != null ? deployableRelease.version() : null));
        respVO.setLatestReleaseVersion(latestRelease != null ? latestRelease.version() : null);
        respVO.setLatestReleaseVersionDisplay(displayVersion(latestRelease != null ? latestRelease.version() : null));
        respVO.setLatestReleaseUrl(latestRelease != null ? latestRelease.releaseUrl() : RELEASES_PAGE_URL);
        respVO.setLatestReleasePublishedAt(latestRelease != null ? latestRelease.publishedAt() : null);
        respVO.setLatestReleaseDockerReady(latestRelease != null && latestRelease.dockerReady());
        respVO.setUpdateAvailable("behind".equals(versionRelation));
        respVO.setComparisonEnabled(comparisonEnabled);
        respVO.setDevelopmentBuild(runtimeVersionInfo.developmentBuild());
        respVO.setBuildProfile(runtimeVersionInfo.buildProfile());
        respVO.setVersionRelation(versionRelation);
        respVO.setReleaseUrl(deployableRelease != null ? deployableRelease.releaseUrl() : RELEASES_PAGE_URL);
        respVO.setTagUrl(deployableRelease != null ? deployableRelease.tagUrl() : RELEASES_PAGE_URL);
        respVO.setPublishedAt(deployableRelease != null ? deployableRelease.publishedAt() : null);
        respVO.setCheckedAt(latest.checkedAt().toString());
        respVO.setSource("github-tag+ghcr");
        respVO.setCheckSucceeded(latest.checkSucceeded());
        respVO.setMessage(resolveMessage(runtimeVersionInfo, latest, versionRelation));
        return respVO;
    }

    private RuntimeVersionInfoRespVO toRuntimeResp(RuntimeVersionInfo runtimeVersionInfo) {
        RuntimeVersionInfoRespVO respVO = new RuntimeVersionInfoRespVO();
        respVO.setCurrentVersion(runtimeVersionInfo.currentVersion());
        respVO.setCurrentVersionDisplay(runtimeVersionInfo.currentVersionDisplay());
        respVO.setDevelopmentBuild(runtimeVersionInfo.developmentBuild());
        respVO.setBuildProfile(runtimeVersionInfo.buildProfile());
        respVO.setComparisonEnabled(runtimeVersionInfo.comparisonEnabled());
        respVO.setMessage(runtimeVersionInfo.message());
        return respVO;
    }

    private RuntimeVersionInfo resolveRuntimeVersionInfo() {
        String currentVersion = resolveCurrentVersion();
        String buildProfile = resolveBuildProfile();
        boolean localProfile = Arrays.stream(environment.getActiveProfiles())
                .anyMatch(profile -> "local".equalsIgnoreCase(profile));
        boolean snapshotVersion = hasText(currentVersion)
                && currentVersion.toUpperCase(Locale.ROOT).contains("SNAPSHOT");
        boolean developmentBuild = localProfile || snapshotVersion;
        boolean comparisonEnabled = hasText(currentVersion)
                && !"unknown".equalsIgnoreCase(currentVersion);

        String message = null;
        if (!hasText(currentVersion) || "unknown".equalsIgnoreCase(currentVersion)) {
            message = "当前运行实例未包含可比较的构建版本，线上版本仅供参考。";
        } else if (localProfile) {
            message = "当前运行在本地开发环境，仍会与线上可部署版本比较；如果本地版本更高，将不会提示升级。";
        } else if (snapshotVersion) {
            message = "当前为 SNAPSHOT 构建，仍会与线上可部署版本比较；如果本地版本更高，将不会提示升级。";
        }

        return new RuntimeVersionInfo(
                currentVersion,
                displayVersion(currentVersion),
                developmentBuild,
                buildProfile,
                comparisonEnabled,
                message
        );
    }

    private String resolveCurrentVersion() {
        if (buildProperties != null && hasText(buildProperties.getVersion())) {
            return sanitizeVersion(buildProperties.getVersion());
        }

        Package appPackage = VersionCheckService.class.getPackage();
        if (appPackage != null && hasText(appPackage.getImplementationVersion())) {
            return sanitizeVersion(appPackage.getImplementationVersion());
        }

        return "unknown";
    }

    private String resolveBuildProfile() {
        String[] activeProfiles = environment.getActiveProfiles();
        if (activeProfiles.length == 0) {
            return "default";
        }
        return String.join(",", activeProfiles);
    }

    private CachedVersionInfo fetchLatestVersionInfo() {
        Request request = new Request.Builder()
                .url(TAGS_API_URL)
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .header("User-Agent", "ai-fusion-video-version-check")
                .build();

        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                String message = "GitHub 版本检查失败: HTTP " + response.code();
                log.warn("[VersionCheck] {}", message);
                return CachedVersionInfo.failure(message);
            }

            if (response.body() == null) {
                String message = "GitHub 版本检查失败: 响应体为空";
                log.warn("[VersionCheck] {}", message);
                return CachedVersionInfo.failure(message);
            }

            List<String> versions = sortReleaseVersions(OBJECT_MAPPER.readTree(response.body().string()));
            if (versions.isEmpty()) {
                String message = "GitHub 版本检查失败: 未找到版本标签";
                log.warn("[VersionCheck] {}", message);
                return CachedVersionInfo.failure(message);
            }

            ReleaseInfo latestRelease = null;
            ReleaseInfo deployableRelease = null;
            for (String version : versions.subList(0, Math.min(MAX_IMAGE_CHECKS, versions.size()))) {
                ReleaseInfo releaseInfo = new ReleaseInfo(
                        version,
                        buildTagUrl(version),
                        buildTagUrl(version),
                        null,
                        areDockerImagesReady(version)
                );
                if (latestRelease == null) {
                    latestRelease = releaseInfo;
                }
                if (releaseInfo.dockerReady()) {
                    deployableRelease = releaseInfo;
                    break;
                }
            }

            String message = null;
            if (!latestRelease.dockerReady()) {
                if (deployableRelease != null) {
                    message = String.format(
                            "最新版本 %s 已打标签，但 Docker 镜像尚未就绪；当前可升级的最新版本为 %s。",
                            displayVersion(latestRelease.version()),
                            displayVersion(deployableRelease.version())
                    );
                } else {
                    message = String.format(
                            "最新版本 %s 已打标签，但 Docker 镜像尚未就绪，暂不建议升级。",
                            displayVersion(latestRelease.version())
                    );
                }
            }

            return CachedVersionInfo.success(latestRelease, deployableRelease, message);
        } catch (IOException e) {
            String message = "GitHub 版本检查失败: " + e.getMessage();
            log.warn("[VersionCheck] {}", message);
            return CachedVersionInfo.failure(message);
        }
    }

    static List<String> sortReleaseVersions(JsonNode tags) {
        List<String> versions = new ArrayList<>();
        if (tags == null || !tags.isArray()) {
            return versions;
        }
        for (JsonNode tag : tags) {
            String name = tag.path("name").asText("").trim();
            if (RELEASE_TAG_PATTERN.matcher(name).matches()) {
                versions.add(name.startsWith("v") ? name.substring(1) : name);
            }
        }
        versions.sort((left, right) -> compareVersions(right, left));
        return versions;
    }

    private boolean areDockerImagesReady(String version) {
        return imageTagExists(BACKEND_IMAGE_REPOSITORY, version)
                && imageTagExists(FRONTEND_IMAGE_REPOSITORY, version);
    }

    private boolean imageTagExists(String repository, String version) {
        try {
            String token = fetchGhcrToken(repository);
            Request request = new Request.Builder()
                    .url(String.format(GHCR_MANIFEST_URL_TEMPLATE, repository,
                            URLEncoder.encode(version, StandardCharsets.UTF_8)))
                    .head()
                    .header("Authorization", "Bearer " + token)
                    .header("Accept", GHCR_MANIFEST_ACCEPT)
                    .header("User-Agent", "ai-fusion-video-version-check")
                    .build();
            try (Response response = httpClient.newCall(request).execute()) {
                if (response.isSuccessful()) {
                    return true;
                }
                if (response.code() != 404) {
                    log.warn("[VersionCheck] GHCR 镜像检测失败: repo={}, tag={}, code={}", repository, version,
                            response.code());
                }
                return false;
            }
        } catch (IOException e) {
            log.warn("[VersionCheck] GHCR 镜像检测异常: repo={}, tag={}, err={}", repository, version,
                    e.getMessage());
            return false;
        }
    }

    private String fetchGhcrToken(String repository) throws IOException {
        Request request = new Request.Builder()
                .url(String.format(GHCR_TOKEN_URL_TEMPLATE, repository))
                .header("User-Agent", "ai-fusion-video-version-check")
                .build();
        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException("GHCR token HTTP " + response.code());
            }
            return OBJECT_MAPPER.readTree(response.body().string()).path("token").asText();
        }
    }

    private String resolveVersionRelation(String currentVersion, String latestVersion, boolean comparisonEnabled) {
        if (!comparisonEnabled || !hasText(currentVersion) || !hasText(latestVersion)) {
            return "incomparable";
        }

        int result = compareVersions(currentVersion, latestVersion);
        if (result < 0) {
            return "behind";
        }
        if (result > 0) {
            return "ahead";
        }
        return "same";
    }

    private String resolveMessage(
            RuntimeVersionInfo runtimeVersionInfo,
            CachedVersionInfo latest,
            String versionRelation
    ) {
        if (!latest.checkSucceeded()) {
            return latest.message();
        }
        List<String> messages = new ArrayList<>();
        if (hasText(runtimeVersionInfo.message())) {
            messages.add(runtimeVersionInfo.message());
        }
        if (hasText(latest.message())) {
            messages.add(latest.message());
        }
        if ("ahead".equals(versionRelation)) {
            messages.add("当前运行版本高于线上最新可部署版本，可能来自本地开发代码或尚未发布的构建。");
        }
        return messages.isEmpty() ? null : String.join(" ", messages);
    }

    static int compareVersions(String left, String right) {
        int[] leftParts = parseVersion(left);
        int[] rightParts = parseVersion(right);
        for (int index = 0; index < leftParts.length; index++) {
            int result = Integer.compare(leftParts[index], rightParts[index]);
            if (result != 0) {
                return result;
            }
        }
        return 0;
    }

    private static int[] parseVersion(String version) {
        Matcher matcher = SEMVER_PATTERN.matcher(version);
        if (!matcher.find()) {
            return new int[]{0, 0, 0, 0};
        }
        return new int[]{
                parseIntSafe(matcher.group(1)),
                parseIntSafe(matcher.group(2)),
                parseIntSafe(matcher.group(3)),
                parseIntSafe(matcher.group(4))
        };
    }

    private static int parseIntSafe(String value) {
        if (!hasText(value)) {
            return 0;
        }
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private String displayVersion(String version) {
        if (!hasText(version)) {
            return "未检测到";
        }
        if ("unknown".equalsIgnoreCase(version)) {
            return "未知版本";
        }
        return "v" + sanitizeVersion(version);
    }

    private static String sanitizeVersion(String version) {
        if (!hasText(version)) {
            return null;
        }
        String normalized = version.trim();
        if (normalized.toLowerCase(Locale.ROOT).startsWith("v")) {
            normalized = normalized.substring(1);
        }
        return normalized;
    }

    private String buildTagUrl(String tagName) {
        if (!hasText(tagName)) {
            return RELEASES_PAGE_URL;
        }
        return "https://github.com/AtWhuhu/ai-fusion-video/tree/v" + sanitizeVersion(tagName);
    }

    private String textOrNull(JsonNode node, String fieldName) {
        JsonNode value = node.path(fieldName);
        return value.isMissingNode() || value.isNull() ? null : value.asText();
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private record CachedVersionInfo(
            ReleaseInfo latestRelease,
            ReleaseInfo deployableRelease,
            Instant checkedAt,
            boolean checkSucceeded,
            String message
    ) {
        private boolean isExpired() {
            return checkedAt.plus(CACHE_TTL).isBefore(Instant.now());
        }

        private static CachedVersionInfo success(ReleaseInfo latestRelease, ReleaseInfo deployableRelease,
                                                 String message) {
            return new CachedVersionInfo(
                    latestRelease,
                    deployableRelease,
                    Instant.now(),
                    true,
                    message
            );
        }

        private static CachedVersionInfo failure(String message) {
            return new CachedVersionInfo(
                    null,
                    null,
                    Instant.now(),
                    false,
                    message
            );
        }

        private static boolean hasTextStatic(String value) {
            return value != null && !value.isBlank();
        }
    }

    private record RuntimeVersionInfo(
            String currentVersion,
            String currentVersionDisplay,
            boolean developmentBuild,
            String buildProfile,
            boolean comparisonEnabled,
            String message
    ) {
    }

    private record ReleaseInfo(
            String version,
            String releaseUrl,
            String tagUrl,
            String publishedAt,
            boolean dockerReady
    ) {
    }
}
