plugins {
    java
    id("org.jetbrains.intellij.platform") version "2.10.2"
}

group = "dev.changestack"
version = "0.2.2"

repositories {
    mavenCentral()
    intellijPlatform { defaultRepositories() }
}

dependencies {
    intellijPlatform {
        intellijIdeaUltimate("2025.3") { useInstaller = false }
        bundledModule("intellij.platform.vcs.impl")
        bundledModule("intellij.platform.collaborationTools")
        bundledModule("intellij.platform.vcs.dvcs.impl")
        bundledPlugin("org.jetbrains.plugins.gitlab")
        bundledPlugin("Git4Idea")
        // Java is exercised by the declaration-navigation regression test.
        bundledPlugin("com.intellij.java")
        testFramework(org.jetbrains.intellij.platform.gradle.TestFrameworkType.Platform)
        pluginVerifier()
    }
    testImplementation("junit:junit:4.13.2")
    compileOnly("org.jetbrains.kotlin:kotlin-stdlib:2.1.20")
}

java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }

intellijPlatform {
    // Settings live in an MR dialog, with no searchable Settings configurable to index.
    buildSearchableOptions = false
    pluginConfiguration {
        ideaVersion { sinceBuild = "253" }
    }
    pluginVerification {
        ides {
            create("IU", "2025.3") { useInstaller = false }
            create("IU", "2026.1") { useInstaller = false }
            create("IU", "2026.1.1") { useInstaller = false }
            create("IU", "2026.2") { useInstaller = false }
        }
    }
}

tasks.withType<JavaCompile>().configureEach { options.encoding = "UTF-8" }
tasks.withType<Test>().configureEach { maxHeapSize = "1g" }
tasks.withType<Jar>().configureEach { exclude("analyzers/**") }
tasks.processResources { exclude("analyzers/**") }
// Plain reports retain all compatibility findings without the verifier's large HTML output.
tasks.verifyPlugin {
    verificationReportsFormats.set(listOf(org.jetbrains.intellij.platform.gradle.tasks.VerifyPluginTask.VerificationReportsFormats.PLAIN))
}

val buildAnalyzers by tasks.registering(Exec::class) {
    workingDir(rootDir.parentFile)
    commandLine("bun", "scripts/build-ide-analyzers.ts")
    inputs.dir(rootDir.parentFile.resolve("src"))
    inputs.file(rootDir.parentFile.resolve("scripts/build-ide-analyzers.ts"))
    inputs.file(rootDir.parentFile.resolve("package.json"))
    outputs.dir(layout.buildDirectory.dir("generated-resources"))
}
// Native executables are payload, not Java resources: keep 270 MB off the IDE classpath.
tasks.withType<org.jetbrains.intellij.platform.gradle.tasks.PrepareSandboxTask>().configureEach {
    dependsOn(buildAnalyzers)
    from(layout.buildDirectory.dir("generated-resources")) { into(pluginName) }
}
