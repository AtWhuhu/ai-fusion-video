package com.stonewu.fusion.service.ai.run;

import lombok.extern.slf4j.Slf4j;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/** Coalesces lossy Redis hints without allowing them to become replay state. */
@Slf4j
final class ReplayWakeGate {

    private final AtomicBoolean dirty = new AtomicBoolean();
    private final AtomicLong highestHint = new AtomicLong();
    private final AtomicReference<Sinks.One<Long>> waiter = new AtomicReference<>();

    // TODO(debug-replay): 临时诊断字段，用于定位 "Only one replay waiter may be active" 的两个来源；定位后连同下方 WARN/抓栈一并移除。
    private final AtomicReference<String> waiterInstaller = new AtomicReference<>();

    void markDirty(long sequenceHint) {
        if (sequenceHint <= 0) {
            throw new IllegalArgumentException("sequenceHint must be positive");
        }
        highestHint.accumulateAndGet(sequenceHint, Math::max);
        dirty.set(true);
        Sinks.One<Long> waiting = waiter.getAndSet(null);
        if (waiting != null) {
            waiterInstaller.set(null);
            waiting.tryEmitValue(sequenceHint);
        }
    }

    void requestPoll() {
        dirty.set(true);
        Sinks.One<Long> waiting = waiter.getAndSet(null);
        if (waiting != null) {
            waiterInstaller.set(null);
            waiting.tryEmitValue(highestHint.get());
        }
    }

    Mono<Long> awaitDirtyOrPoll(Duration pollInterval) {
        Duration safeInterval = Objects.requireNonNull(
                pollInterval, "pollInterval must not be null");
        if (safeInterval.isZero() || safeInterval.isNegative()) {
            return Mono.error(new IllegalArgumentException(
                    "pollInterval must be positive"));
        }
        return Mono.defer(() -> {
            Long ready = consumeDirty();
            if (ready != null) {
                return Mono.just(ready);
            }

            Sinks.One<Long> installed = Sinks.one();
            String installerStack = captureStack();
            if (!waiter.compareAndSet(null, installed)) {
                // TODO(debug-replay): 临时抓栈，定位并发 waiter 来源后移除。
                log.warn("[ReplayWakeGate] Only one replay waiter may be active.\n"
                                + "【冲突方】本次尝试安装 waiter：\n{}\n"
                                + "【已存在】先前安装 waiter 且尚未清除：\n{}",
                        installerStack, waiterInstaller.get());
                return Mono.error(new IllegalStateException(
                        "Only one replay waiter may be active"));
            }
            waiterInstaller.set(installerStack);
            ready = consumeDirty();
            if (ready != null) {
                waiter.compareAndSet(installed, null);
                waiterInstaller.compareAndSet(installerStack, null);
                installed.tryEmitEmpty();
                return Mono.just(ready);
            }

            return Mono.firstWithSignal(
                            installed.asMono(),
                            Mono.delay(safeInterval).thenReturn(0L))
                    .map(this::consumeAfterWake)
                    .doFinally(ignored -> {
                        waiter.compareAndSet(installed, null);
                        waiterInstaller.compareAndSet(installerStack, null);
                    });
        });
    }

    // TODO(debug-replay): 临时诊断方法，定位后移除。
    private static String captureStack() {
        StackTraceElement[] trace = Thread.currentThread().getStackTrace();
        StringBuilder sb = new StringBuilder(Thread.currentThread().getName());
        int limit = Math.min(trace.length, 18);
        for (int i = 0; i < limit; i++) {
            sb.append("\n    at ").append(trace[i]);
        }
        return sb.toString();
    }

    private Long consumeDirty() {
        return dirty.getAndSet(false) ? highestHint.get() : null;
    }

    private long consumeAfterWake(long sequenceHint) {
        dirty.set(false);
        return sequenceHint;
    }
}
