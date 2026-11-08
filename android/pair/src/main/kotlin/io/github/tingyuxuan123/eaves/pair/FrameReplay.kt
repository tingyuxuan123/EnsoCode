package io.github.tingyuxuan123.eaves.pair

import java.nio.ByteBuffer
import java.security.SecureRandom
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private const val PREFIX_SIZE = 8
private const val NONCE_SIZE = 12
private const val WINDOW_BITS = 64
private const val MAX_PREFIXES = 128
private const val MAX_COUNTER = 0xffff_ffffL
private val secureRandom = SecureRandom()
private val canonicalId = Regex("[A-Za-z0-9_-]{11}")

enum class ReplayRole { Host, Guest }

data class OpenedReplayFrame(val payload: JsonObject, val trusted: Boolean)

internal fun nextReplayCounter(counter: Long): Long {
    if (counter < 0 || counter >= MAX_COUNTER) throw PairCryptoException("Replay counter exhausted")
    return counter + 1
}

private val bootstrapCommands = setOf(
    "replay-hello", "snapshot", "subscribe", "history", "direct-offer", "direct-ice", "direct-close", "probe",
)
private val bootstrapResponses = setOf(
    "replay-hello", "host-info", "catalog", "projects", "providers", "appearance", "push-config",
    "session-sync", "agent-event", "history", "direct-answer", "direct-ice", "probe-ack",
)

fun isReplayBootstrap(type: String): Boolean = type in bootstrapCommands

fun isReplayBootstrapResponse(type: String): Boolean = type in bootstrapResponses

/**
 * Kotlin port of packages/pair/src/replay.ts, scoped to one content key and shared by its transports.
 * JCE work happens outside the state lock; stale crypto cannot commit after a peer reset.
 * The connection owns command/response gating and must supply a synchronous durable [onModern]
 * callback (throw on failure) and recheck transport generation before dispatching/sending a result.
 * Callbacks run under the state lock: do not re-enter replay or take another connection lock.
 * A JVM [Error] from persistence propagates only after marking replay failed.
 */
class FrameReplay internal constructor(
    contentKey: ByteArray,
    role: ReplayRole,
    private val announce: Boolean,
    requireModern: Boolean,
    private val onModern: () -> Unit,
    private val randomBytes: (Int) -> ByteArray,
    private val encrypt: (ByteArray, JsonElement, ByteArray) -> ByteArray = FrameCrypto::sealWithNonce,
    private val decrypt: (ByteArray, ByteArray) -> JsonElement = FrameCrypto::open,
) {
    constructor(
        contentKey: ByteArray,
        role: ReplayRole? = null,
        announce: Boolean = false,
        requireModern: Boolean = false,
        onModern: () -> Unit = {},
    ) : this(contentKey, role ?: if (announce) ReplayRole.Host else ReplayRole.Guest, announce,
        requireModern, onModern, { size -> ByteArray(size).also(secureRandom::nextBytes) })

    private val lock = Any()
    private val key = contentKey.copyOf().also {
        if (it.size != 32) throw PairCryptoException("Content key must be 32 bytes")
    }
    private val roleId = if (role == ReplayRole.Host) "h" else "g"
    private val prefix = fresh(PREFIX_SIZE)
    private val prefixId = PairEncoding.toBase64Url(prefix)
    private var challenge = PairEncoding.toBase64Url(fresh(PREFIX_SIZE))
    private val windows = mutableMapOf<String, Window>()
    private var counter = 0L
    private var epoch = 0L
    private var modern = requireModern
    private var observedModern = false
    private var legacyReady = false
    private var failed = false
    private var peer: String? = null
    private var challengeOwner: String? = null
    private var echo: String? = null
    private var hello = announce || modern

    private class Window(var high: Long, var bits: Long, var challenge: String)
    private data class Stamp(val role: String, val prefix: String, val challenge: String, val echo: String?)
    private data class Outgoing(val epoch: Long, val payload: JsonElement, val nonce: ByteArray)

    fun peerReset() = synchronized(lock) {
        epoch++
        if (failed) return@synchronized
        challengeOwner = null
        legacyReady = false
        hello = false
        val next = try {
            PairEncoding.toBase64Url(fresh(PREFIX_SIZE))
        } catch (error: Throwable) {
            // Even a provider failure must not leave the previous challenge usable on a new link.
            failed = true
            throw error
        }
        if (next == challenge) {
            failed = true
            return@synchronized
        }
        challenge = next
        hello = modern || announce
        // Keep the peer identity, nonce domains and outgoing counter across transport switches.
    }

    fun takeHello(): Boolean = synchronized(lock) {
        val pending = hello && !failed
        hello = false
        pending
    }

    fun isReady(): Boolean = synchronized(lock) { !failed && (challengeOwner != null || (!modern && legacyReady)) }

    fun isFailed(): Boolean = synchronized(lock) { failed }

    fun seal(payload: JsonElement): ByteArray {
        val outgoing = synchronized(lock) {
            if (failed) throw PairCryptoException("Replay state exhausted")
            if (!announce && !modern) {
                Outgoing(epoch, payload, fresh(NONCE_SIZE))
            } else {
                if (counter == MAX_COUNTER) {
                    failed = true
                    throw PairCryptoException("Replay counter exhausted")
                }
                // Reserve before encryption, even if the body is invalid or the generation changes.
                counter = nextReplayCounter(counter)
                val nonce = ByteBuffer.allocate(NONCE_SIZE).put(prefix).putInt(counter.toInt()).array()
                val body = payload as? JsonObject ?: throw PairCryptoException("Replay payload must be an object")
                val stamp = linkedMapOf("r" to JsonPrimitive(roleId), "p" to JsonPrimitive(prefixId),
                    "c" to JsonPrimitive(challenge))
                echo?.let { stamp["e"] = JsonPrimitive(it) }
                Outgoing(epoch, JsonObject(body + ("replay" to JsonObject(stamp))), nonce)
            }
        }
        val frame = encrypt(key, outgoing.payload, outgoing.nonce)
        synchronized(lock) {
            if (outgoing.epoch != epoch || failed) throw PairCryptoException("Replay epoch changed")
        }
        return frame
    }

    /** [current] is a non-blocking generation check; it is called before and after decryption. */
    fun open(frame: ByteArray, current: () -> Boolean = { true }): OpenedReplayFrame? {
        val started = synchronized(lock) {
            if (failed || !current()) return null
            epoch
        }
        // Nonce reads during commit must use the exact packet that JCE authenticated.
        val packet = frame.copyOf()
        val payload = decrypt(key, packet)
        return synchronized(lock) {
            if (failed || started != epoch || !current()) return@synchronized null
            acceptFrame(payload, packet)
        }
    }

    private fun acceptFrame(payload: JsonElement, frame: ByteArray): OpenedReplayFrame? {
        val body = payload as? JsonObject ?: return null
        if (body["type"].text() == null) return null
        if ("replay" !in body) {
            if (modern) return null
            legacyReady = true
            return OpenedReplayFrame(body, trusted = true)
        }
        val stamp = readStamp(body["replay"]) ?: return null
        if (stamp.role == roleId || frame.size < 1 + NONCE_SIZE || stamp.prefix == prefixId ||
            stamp.challenge == challenge) return null
        if (PairEncoding.toBase64Url(frame.copyOfRange(1, 1 + PREFIX_SIZE)) != stamp.prefix) return null
        val number = ByteBuffer.wrap(frame, 1 + PREFIX_SIZE, 4).int.toLong() and MAX_COUNTER
        if (number == 0L) return null
        val previous = windows[stamp.prefix]
        val bits = acceptCounter(previous, number) ?: return null
        if (previous == null && windows.size >= MAX_PREFIXES) {
            failed = true
            return null
        }
        val newChallenge = previous == null || (number > previous.high && stamp.challenge != previous.challenge)
        val window = previous ?: Window(0L, 0L, stamp.challenge)
        window.bits = bits
        window.high = maxOf(window.high, number)
        if (newChallenge) {
            window.challenge = stamp.challenge
            if (peer == null || peer == stamp.prefix || challengeOwner == null) {
                echo = stamp.challenge
                hello = true
            }
        }
        windows[stamp.prefix] = window
        modern = true
        if (!observedModern) {
            try {
                onModern()
                observedModern = true
            } catch (_: Exception) {
                return null
            } finally {
                // A failed pin (including fatal JVM errors) cannot leave a usable connection.
                if (!observedModern) failed = true
            }
        }
        if (stamp.echo == challenge && challengeOwner == null) {
            challengeOwner = stamp.prefix
            peer = stamp.prefix
            echo = window.challenge
            hello = true
        }
        return OpenedReplayFrame(JsonObject(body - "replay"),
            trusted = challengeOwner == stamp.prefix && stamp.echo == challenge)
    }

    private fun acceptCounter(window: Window?, number: Long): Long? {
        if (window == null) return 1L
        if (number > window.high) {
            val shift = number - window.high
            // Signed Long is just a 64-bit bitset; overflow truncates like TS's WINDOW_MASK.
            return if (shift >= WINDOW_BITS) 1L else (window.bits shl shift.toInt()) or 1L
        }
        val behind = window.high - number
        if (behind >= WINDOW_BITS) return null
        val mask = 1L shl behind.toInt()
        return if ((window.bits and mask) != 0L) null else window.bits or mask
    }

    private fun readStamp(value: JsonElement?): Stamp? {
        val stamp = value as? JsonObject ?: return null
        if (stamp.keys.any { it != "r" && it != "p" && it != "c" && it != "e" }) return null
        val role = stamp["r"].text()?.takeIf { it == "h" || it == "g" } ?: return null
        val prefix = stamp["p"].readId() ?: return null
        val challenge = stamp["c"].readId() ?: return null
        val echo = if ("e" in stamp) stamp["e"].readId() ?: return null else null
        return Stamp(role, prefix, challenge, echo)
    }

    private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun JsonElement?.readId(): String? {
        val value = text()?.takeIf(canonicalId::matches) ?: return null
        val bytes = PairEncoding.fromBase64Url(value)
        return value.takeIf { bytes.size == PREFIX_SIZE && PairEncoding.toBase64Url(bytes) == it }
    }

    private fun fresh(size: Int): ByteArray = randomBytes(size).also {
        if (it.size != size) throw PairCryptoException("Invalid replay entropy")
    }.copyOf()
}
