package io.github.tingyuxuan123.eaves.mirror

class PairCredentials(
    val pairId: String,
    val deviceToken: String,
    contentKey: ByteArray,
    val deviceName: String,
    val relayUrl: String,
    val replayVersion: Int? = null,
) {
    private val key = contentKey.copyOf()
    val contentKey: ByteArray get() = key.copyOf()

    override fun toString(): String = "PairCredentials([redacted])"
}

interface PairCredentialStore {
    /** Returns null only when no pair is stored. Unreadable credentials fail closed. */
    fun load(): PairCredentials?
    fun save(credentials: PairCredentials)
    /** Durably require modern replay for the currently stored identity, or throw. */
    fun pin(credentials: PairCredentials)
    fun clear(expectedPairId: String? = null)
}

enum class PairFailure {
    INVALID_LINK, DENIED, NETWORK, OUTCOME_UNKNOWN, INVALID_RESPONSE, STORAGE,
}

/** Stable UI classification. No URL, relay text or underlying exception is attached. */
class PairException(val reason: PairFailure) : RuntimeException(
    when (reason) {
        PairFailure.INVALID_LINK -> "Invalid pairing link"
        PairFailure.DENIED -> "Pairing relay rejected the request"
        PairFailure.NETWORK -> "Pairing relay connection failed"
        PairFailure.OUTCOME_UNKNOWN -> "Pairing claim result is unknown"
        PairFailure.INVALID_RESPONSE -> "Unexpected pairing relay response"
        PairFailure.STORAGE -> "Pairing credentials could not be stored or read"
    }
)
