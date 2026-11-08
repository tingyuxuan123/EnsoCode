package io.github.tingyuxuan123.eaves.pair

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

internal object WireJson {
    // Bound the library's recursive reader/writer, not just our validation walk.
    private const val MAX_DEPTH = 128
    private val number = Regex("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?")
    private fun invalid(): Nothing = throw PairCryptoException("Frame payload is not JSON")

    fun parse(text: String): JsonElement {
        val source = text.removePrefix("\uFEFF") // TextDecoder consumes one leading UTF-8 BOM.
        preflight(source)
        return try {
            Json.parseToJsonElement(source).also { validateTree(it, 0) }
        } catch (_: SerializationException) {
            // kotlinx exceptions include the JSON input. Never attach that plaintext to logs.
            invalid()
        }
    }

    fun stringify(value: JsonElement): String {
        validateTree(value, 0)
        val encoded = value.toString()
        // JSON.stringify escapes lone UTF-16 surrogates; UTF-8 encoding must not replace them with '?'.
        return buildString(encoded.length) {
            for ((index, char) in encoded.withIndex()) {
                val lone = (char.isHighSurrogate() && encoded.getOrNull(index + 1)?.isLowSurrogate() != true) ||
                    (char.isLowSurrogate() && encoded.getOrNull(index - 1)?.isHighSurrogate() != true)
                if (lone) append("\\u").append(char.code.toString(16)) else append(char)
            }
        }
    }

    private fun preflight(text: String) {
        var inString = false
        var escaped = false
        var depth = 0
        val token = StringBuilder()
        fun finishToken() {
            if (token.isEmpty()) return
            val value = token.toString()
            if (value != "true" && value != "false" && value != "null" && !number.matches(value)) invalid()
            token.setLength(0)
        }
        for (char in text) {
            if (char.code < 0x20 && (inString || char !in "\t\r\n")) invalid()
            if (inString) {
                if (escaped) escaped = false
                else if (char == '\\') escaped = true
                else if (char == '"') inString = false
            } else when (char) {
                '"' -> { finishToken(); inString = true }
                '[', '{' -> { finishToken(); if (++depth > MAX_DEPTH) invalid() }
                ']', '}' -> { finishToken(); if (--depth < 0) invalid() }
                ':', ',', ' ', '\t', '\r', '\n' -> finishToken()
                else -> token.append(char)
            }
        }
        finishToken()
        if (inString || depth != 0) invalid()
    }

    // The kotlinx tree reader also retains unquoted tokens that JSON.parse would reject.
    private fun validateTree(value: JsonElement, depth: Int) {
        when (value) {
            is JsonObject -> {
                if (depth >= MAX_DEPTH) invalid()
                value.values.forEach { validateTree(it, depth + 1) }
            }
            is JsonArray -> {
                if (depth >= MAX_DEPTH) invalid()
                value.forEach { validateTree(it, depth + 1) }
            }
            is JsonPrimitive -> if (value !== JsonNull && !value.isString && value.content != "true" &&
                value.content != "false" && !number.matches(value.content)) invalid()
        }
    }
}
