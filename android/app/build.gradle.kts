plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace="com.zungun.app"; compileSdk=35
    defaultConfig { applicationId="com.zungun.app"; minSdk=26; targetSdk=35; versionCode=83; versionName="1.0-order083"; testInstrumentationRunner="androidx.test.runner.AndroidJUnitRunner" }
    compileOptions { sourceCompatibility=JavaVersion.VERSION_17; targetCompatibility=JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget="17" }
}
dependencies {
    implementation(project(":runtime"))
    implementation(project(":pocket"))
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core-ktx:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.work:work-testing:2.10.0")
    androidTestImplementation("androidx.room:room-runtime:2.6.1")
    testImplementation("junit:junit:4.13.2")
}
