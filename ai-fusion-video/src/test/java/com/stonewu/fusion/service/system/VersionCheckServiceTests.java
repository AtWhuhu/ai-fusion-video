package com.stonewu.fusion.service.system;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class VersionCheckServiceTests {

    @Test
    void comparesForkBuildNumbersAfterBaseVersion() {
        assertThat(VersionCheckService.compareVersions("1.2.2-fork.17", "1.2.2-fork.17")).isZero();
        assertThat(VersionCheckService.compareVersions("1.2.2-fork.9", "1.2.2-fork.17")).isNegative();
        assertThat(VersionCheckService.compareVersions("1.2.2-fork.17", "1.2.2")).isPositive();
        assertThat(VersionCheckService.compareVersions("1.2.2-fork.17", "1.3.0-fork.1")).isNegative();
        assertThat(VersionCheckService.compareVersions("1.2.0", "1.2.2-fork.17")).isNegative();
    }

    @Test
    void sortsForkTagsByVersionAndSkipsOtherTags() throws Exception {
        var tags = new ObjectMapper().readTree("""
                [{"name":"v1.2.2-fork.9"},{"name":"v1.2.2-fork.17"},{"name":"nightly"},
                 {"name":"v1.2.2-fork.10"},{"name":"v1.2.0"},{"name":"v1.2.2-rc.1"}]
                """);
        assertThat(VersionCheckService.sortReleaseVersions(tags))
                .containsExactly("1.2.2-fork.17", "1.2.2-fork.10", "1.2.2-fork.9", "1.2.0");
    }
}
