pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    val runtimeRepository = providers.gradleProperty("zungunRuntimeRepository").orNull
        ?: error("-PzungunRuntimeRepository=<producer Maven repository> is required")
    repositories {
        maven { url = uri(runtimeRepository) }
        google()
        mavenCentral()
    }
}

rootProject.name = "external-consumer"
