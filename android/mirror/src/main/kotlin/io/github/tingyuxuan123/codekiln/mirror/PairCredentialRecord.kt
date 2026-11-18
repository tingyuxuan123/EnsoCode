package io.github.tingyuxuan123.eaves.mirror

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.security.MessageDigest

/** Versioned plaintext format used only inside the encrypted credential envelope. */
internal object PairCredentialRecord {
    const val KEY_LENGTH = 32
    const val MAX_NAME_LENGTH = 64
    const val MAX_SIZE = 16 * 1024
    private const val VERSION = 1
    private val routeIdentifier = Regex("[A-Za-z0-9_-]{1,128}")

    fun isRouteIdentifier(value: String): Boolean = routeIdentifier.matches(value)

    fun normalize(credentials: PairCredentials, allowLoopbackHttp: Boolean): PairCredentials {
        val relay = PairRelayUrl.parse(credentials.relayUrl, allowLoopbackHttp).toString()
        val key = credentials.contentKey
        return try {
            validate(credentials, key)
            PairCredentials(credentials.pairId, credentials.deviceToken, key, credentials.deviceName, relay, credentials.replayVersion)
        } finally {
            key.fill(0)
        }
    }

    fun encode(credentials: PairCredentials): ByteArray {
        val key = credentials.contentKey
        return try {
            validate(credentials, key)
            val bytes = ByteArrayOutputStream()
            DataOutputStream(bytes).use { out ->
                out.writeByte(VERSION)
                out.writeUTF(credentials.pairId)
                out.writeUTF(credentials.deviceToken)
                out.write(key)
                out.writeUTF(credentials.deviceName)
                out.writeUTF(credentials.relayUrl)
                out.writeByte(credentials.replayVersion ?: 0)
            }
            bytes.toByteArray()
        } finally {
            key.fill(0)
        }
    }

    fun decode(bytes: ByteArray, allowLoopbackHttp: Boolean): PairCredentials {
        require(bytes.size in 1..MAX_SIZE) { "Invalid credential record" }
        val key = ByteArray(KEY_LENGTH)
        try {
            return DataInputStream(ByteArrayInputStream(bytes)).use { input ->
                require(input.readUnsignedByte() == VERSION) { "Invalid credential record" }
                val id = input.readUTF()
                val token = input.readUTF()
                input.readFully(key)
                val name = input.readUTF()
                val relay = input.readUTF()
                val pin = when (input.readUnsignedByte()) {
                    0 -> null
                    1 -> 1
                    else -> throw IllegalArgumentException("Invalid credential record")
                }
                require(input.read() == -1) { "Invalid credential record" }
                normalize(PairCredentials(id, token, key, name, relay, pin), allowLoopbackHttp)
            }
        } catch (_: IOException) {
            throw IllegalArgumentException("Invalid credential record")
        } finally {
            key.fill(0)
        }
    }

    fun preservePin(current: PairCredentials?, next: PairCredentials): PairCredentials =
        if (current?.replayVersion == 1 && sameIdentity(current, next)) withPin(next) else next

    fun pin(current: PairCredentials?, expected: PairCredentials): PairCredentials {
        require(current != null && sameIdentity(current, expected)) { "Pairing identity changed" }
        return withPin(current)
    }

    private fun withPin(credentials: PairCredentials): PairCredentials {
        if (credentials.replayVersion == 1) return credentials
        val key = credentials.contentKey
        return try {
            PairCredentials(credentials.pairId, credentials.deviceToken, key, credentials.deviceName, credentials.relayUrl, 1)
        } finally {
            key.fill(0)
        }
    }

    private fun sameIdentity(left: PairCredentials, right: PairCredentials): Boolean {
        if (left.pairId != right.pairId || left.deviceToken != right.deviceToken || left.relayUrl != right.relayUrl) return false
        val a = left.contentKey
        val b = right.contentKey
        return try {
            MessageDigest.isEqual(a, b)
        } finally {
            a.fill(0)
            b.fill(0)
        }
    }

    private fun validate(credentials: PairCredentials, key: ByteArray) {
        require(isRouteIdentifier(credentials.pairId) && isRouteIdentifier(credentials.deviceToken) &&
            key.size == KEY_LENGTH && credentials.deviceName.isNotBlank() &&
            credentials.deviceName.length <= MAX_NAME_LENGTH && credentials.deviceName.none(Char::isISOControl) &&
            credentials.relayUrl.length <= PairRelayUrl.MAX_LENGTH && (credentials.replayVersion == null || credentials.replayVersion == 1)
        ) { "Invalid credential record" }
    }
}
