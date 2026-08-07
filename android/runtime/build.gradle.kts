plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.kapt")
    id("maven-publish")
}

android {
    namespace = "com.zungun.runtime"
    compileSdk = 35
    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    kapt("androidx.room:room-compiler:2.6.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core-ktx:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.room:room-testing:2.6.1")
    androidTestImplementation("androidx.work:work-testing:2.10.0")
}

kapt { correctErrorTypes = true }

publishing {
    publications {
        create<org.gradle.api.publish.maven.MavenPublication>("release") {
            groupId = "com.zungun"
            artifactId = "zungun-runtime"
            version = "1.0.80"
            artifact(layout.buildDirectory.file("outputs/aar/runtime-release.aar"))
            pom.withXml {
                val dependenciesNode = asNode().appendNode("dependencies")
                fun runtimeDependency(groupId: String, artifactId: String, version: String) {
                    val dependency = dependenciesNode.appendNode("dependency")
                    dependency.appendNode("groupId", groupId)
                    dependency.appendNode("artifactId", artifactId)
                    dependency.appendNode("version", version)
                    dependency.appendNode("scope", "runtime")
                }
                runtimeDependency("androidx.core", "core-ktx", "1.15.0")
                runtimeDependency("androidx.room", "room-runtime", "2.6.1")
                runtimeDependency("androidx.room", "room-ktx", "2.6.1")
                runtimeDependency("androidx.work", "work-runtime-ktx", "2.10.0")
            }
        }
    }
    repositories {
        maven {
            name = "order080"
            url = uri(layout.buildDirectory.dir("order080-repo"))
        }
    }
}
