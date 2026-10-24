import org.gradle.api.tasks.testing.Test
import org.gradle.jvm.toolchain.JavaLanguageVersion

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.zungun.pocket"
    compileSdk = 35
    defaultConfig { minSdk = 26 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("com.goterl:lazysodium-android:5.2.0")
    testImplementation("com.goterl:lazysodium-java:5.2.0")
    testImplementation("junit:junit:4.13.2")
}

// Lazysodium Java 5.2.0 is bytecode level 21. Keep Android production bytecode at
// 17, but run JVM unit tests with a Java 21 launcher so the crypto test provider
// is loadable instead of failing with UnsupportedClassVersionError.
tasks.withType<Test>().configureEach {
    javaLauncher.set(javaToolchains.launcherFor {
        languageVersion.set(JavaLanguageVersion.of(21))
    })
}
