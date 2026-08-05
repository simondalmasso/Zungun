package com.zungun.runtime.network
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.zungun.runtime.model.ConnectivityClass
class ConnectivityClassifier(private val context:Context){fun current():ConnectivityClass{val manager=context.getSystemService(ConnectivityManager::class.java);val network=manager.activeNetwork?:return ConnectivityClass.OFFLINE;val caps=manager.getNetworkCapabilities(network)?:return ConnectivityClass.OFFLINE;return if(caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED))ConnectivityClass.UNMETERED else ConnectivityClass.CONSTRAINED}}
