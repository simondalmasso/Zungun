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
