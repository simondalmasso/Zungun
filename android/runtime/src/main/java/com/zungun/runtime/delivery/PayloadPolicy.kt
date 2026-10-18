package com.zungun.runtime.delivery
import com.zungun.runtime.model.*
object PayloadPolicy { fun decide(connectivity:ConnectivityClass,payloadBytes:Int,declaredLimit:Int):DeliveryDecision {val adaptive=when(connectivity){ConnectivityClass.OFFLINE->0;ConnectivityClass.CONSTRAINED->minOf(16_384,declaredLimit);ConnectivityClass.UNMETERED->declaredLimit};return DeliveryDecision(payloadBytes<=adaptive,if(payloadBytes<=adaptive)"ALLOWED" else "PAYLOAD_CONSTRAINED",adaptive)} }
