plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android { namespace="com.zungun.sample";compileSdk=35;defaultConfig{applicationId="com.zungun.sample";minSdk=26;targetSdk=35;versionCode=1;versionName="1.0-order075"};compileOptions{sourceCompatibility=JavaVersion.VERSION_17;targetCompatibility=JavaVersion.VERSION_17};kotlinOptions{jvmTarget="17"} }
dependencies { implementation(project(":runtime")); implementation("androidx.activity:activity-ktx:1.10.0"); implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7") }
