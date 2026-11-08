import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    `java-library`
    alias(libs.plugins.kotlin.jvm)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    api(libs.kotlinx.serialization.json)
    implementation(libs.tweetnacl.java)
    testImplementation(libs.kotlin.test.junit)
    testImplementation(libs.junit)
}

tasks.test {
    // Repository-controlled TS golden vectors; no credentials or developer configuration.
    val vectors = rootProject.file("../packages/pair/vectors")
    inputs.dir(vectors).withPathSensitivity(PathSensitivity.RELATIVE)
    systemProperty("eaves.pair.vectors", vectors.absolutePath)
    filter.excludeTestsMatching("*.KotlinGuestInteropTest")
}

// Test-only JDK HTTP/WebSocket transport; no JVM desktop APIs are shipped in :pair.
tasks.register<Test>("interopTest") {
    description = "Run Kotlin guest against a disposable Go relay and the TS fake host (Go + Node required)"
    group = "verification"
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    filter.includeTestsMatching("io.github.tingyuxuan123.eaves.pair.KotlinGuestInteropTest")
    environment("EAVES_KOTLIN_PAIR_GO", "1")
    systemProperty("eaves.pair.workspace", rootProject.projectDir.parentFile.absolutePath)
    // This is real network/process work; never report a cached or skipped smoke as current evidence.
    doNotTrackState("A fresh relay process and pairing are required for each smoke run")
}
