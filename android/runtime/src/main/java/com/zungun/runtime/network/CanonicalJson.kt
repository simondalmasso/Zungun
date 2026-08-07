package com.zungun.runtime.network

import org.json.JSONArray
import org.json.JSONObject

object CanonicalJson {
    fun stringify(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is Boolean -> if (value) "true" else "false"
        is Number -> canonicalNumber(value)
        is String -> canonicalString(value)
        is JSONArray -> buildString {
            append('[')
            for (index in 0 until value.length()) {
                if (index > 0) append(',')
                append(stringify(value.get(index)))
            }
            append(']')
        }
        is JSONObject -> buildString {
            append('{')
            val keys = value.keys().asSequence().toList().sorted()
            keys.forEachIndexed { index, key ->
                if (index > 0) append(',')
                append(canonicalString(key)).append(':').append(stringify(value.get(key)))
            }
            append('}')
        }
        else -> error("UNSUPPORTED_CANONICAL_JSON_TYPE")
    }

    private fun canonicalString(value: String): String = JSONObject.quote(value).replace("\\/", "/")

    private fun canonicalNumber(value: Number): String {
        val number = value.toDouble()
        require(number.isFinite()) { "NON_FINITE_NUMBER" }
        require(!(number == 0.0 && 1.0 / number == Double.NEGATIVE_INFINITY)) { "NEGATIVE_ZERO" }
        return if (number % 1.0 == 0.0) value.toLong().toString() else value.toString()
    }
}
