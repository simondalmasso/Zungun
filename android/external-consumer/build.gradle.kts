plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "com.zungun.consumer"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.zungun.consumer"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.76"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation(project(mapOf("path" to ":runtime", "configuration" to "releaseAarArtifact")))
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    androidTestImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core-ktx:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.work:work-testing:2.10.0")
}
