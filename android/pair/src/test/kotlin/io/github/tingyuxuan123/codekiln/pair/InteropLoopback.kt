package io.github.tingyuxuan123.eaves.pair

import java.io.ByteArrayOutputStream
import java.net.Proxy
import java.net.ProxySelector
import java.net.SocketAddress
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.WebSocket
import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionStage
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

/** JVM-test-only transport. Neither fixture output nor credential-bearing URIs enter failures. */
internal class InteropHttp : AutoCloseable {
    private val executor: ExecutorService = Executors.newFixedThreadPool(3) { task ->
        Thread(task, "pair-interop-http").apply { isDaemon = true }
    }
    val client: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .followRedirects(HttpClient.Redirect.NEVER)
        .proxy(object : ProxySelector() {
            override fun select(uri: URI): List<Proxy> = listOf(Proxy.NO_PROXY)
            override fun connectFailed(uri: URI, address: SocketAddress, error: java.io.IOException) = Unit
        })
        .executor(executor)
        .build()

    fun claim(relay: String, body: JsonObject): JsonObject {
        val request = HttpRequest.newBuilder(URI.create("$relay/v1/pair/claim"))
            .timeout(Duration.ofSeconds(8))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
            .build()
        val response = interopAwait(client.sendAsync(request, HttpResponse.BodyHandlers.ofString()), "pair claim")
        if (response.statusCode() != 200) throw AssertionError("Pair claim did not succeed")
        return try {
            WireJson.parse(response.body()) as? JsonObject ?: throw AssertionError("Invalid pair claim response")
        } catch (_: IllegalArgumentException) {
            throw AssertionError("Invalid pair claim response")
        }
    }

    fun revoke(endpoint: URI) {
        val request = HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(8)).DELETE().build()
        val response = interopAwait(client.sendAsync(request, HttpResponse.BodyHandlers.discarding()), "pair revoke")
        if (response.statusCode() != 200) throw AssertionError("Pair revoke did not succeed")
    }

    override fun close() {
        executor.shutdownNow()
        if (!executor.awaitTermination(3, TimeUnit.SECONDS)) throw AssertionError("HTTP executor did not stop")
    }
}

internal fun <T> interopAwait(future: CompletableFuture<T>, label: String, seconds: Long = 10): T = try {
    future.get(seconds, TimeUnit.SECONDS)
} catch (_: Exception) {
    future.cancel(true)
    // HttpClient exceptions can include tokens in a URI; deliberately do not attach the cause.
    throw AssertionError("Timed out or failed: $label")
}

internal class InteropProcess private constructor(private val process: Process, private val label: String) : AutoCloseable {
    private val output = StringBuilder()
    @Volatile private var overflow = false
    private val reader = Thread({
        try {
            process.inputStream.bufferedReader(Charsets.UTF_8).use { input ->
                val buffer = CharArray(2048)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    synchronized(output) {
                        if (output.length + count <= 262_144) output.append(buffer, 0, count)
                        else overflow = true // Keep draining, but never accumulate unbounded fixture output.
                    }
                }
            }
        } catch (_: java.io.IOException) {
            // Closing a process pipe during bounded cleanup is expected.
        }
    }, "pair-interop-$label").apply { isDaemon = true; start() }

    fun waitFor(pattern: Regex, group: Int = 0): String {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(12)
        while (System.nanoTime() < deadline) {
            if (overflow) throw AssertionError("Excessive $label output")
            synchronized(output) { pattern.find(output)?.let { return it.groupValues[group] } }
            if (!process.isAlive) throw AssertionError("$label exited before readiness")
            Thread.sleep(15)
        }
        throw AssertionError("Timed out waiting for $label readiness")
    }

    fun awaitExit(seconds: Long): Int {
        if (!process.waitFor(seconds, TimeUnit.SECONDS)) throw AssertionError("Timed out waiting for $label exit")
        reader.join(1000)
        if (reader.isAlive) throw AssertionError("Timed out draining $label")
        if (overflow) throw AssertionError("Excessive $label output")
        return process.exitValue()
    }

    fun contains(value: String): Boolean = synchronized(output) { output.contains(value) }

    override fun close() {
        val descendants = process.toHandle().descendants().use { it.toList() }
        descendants.forEach { if (it.isAlive) it.destroy() }
        if (process.isAlive) process.destroy()
        try {
            process.waitFor(2, TimeUnit.SECONDS)
        } finally {
            descendants.forEach { if (it.isAlive) it.destroyForcibly() }
            if (process.isAlive) process.destroyForcibly()
        }
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
        while ((process.isAlive || descendants.any { it.isAlive }) && System.nanoTime() < deadline) Thread.sleep(10)
        if (process.isAlive || descendants.any { it.isAlive }) throw AssertionError("Could not stop $label")
        process.inputStream.close()
        process.errorStream.close()
        process.outputStream.close()
        reader.join(1000)
        if (reader.isAlive) throw AssertionError("Could not stop $label output reader")
    }

    companion object {
        fun start(label: String, cwd: Path, vararg command: String): InteropProcess {
            val builder = ProcessBuilder(command.toList()).directory(cwd.toFile()).redirectErrorStream(true)
            // Do not inherit TLS paths or injected Node startup code from a developer environment.
            listOf("RELAY_TLS_CERT", "RELAY_TLS_KEY", "NODE_OPTIONS", "NODE_USE_ENV_PROXY")
                .forEach { builder.environment().remove(it) }
            val process = try {
                builder.start()
            } catch (_: java.io.IOException) {
                throw AssertionError("Could not start $label; required Go and Node must be available on PATH")
            }
            return InteropProcess(process, label)
        }
    }
}

internal sealed interface InteropMessage {
    data class Binary(val bytes: ByteArray) : InteropMessage
    data class Text(val value: String) : InteropMessage
    data class Closed(val code: Int) : InteropMessage
}

/** Listener only assembles messages; all replay state and sends are serialized by the test thread. */
internal class InteropSocket(client: HttpClient, endpoint: URI) : WebSocket.Listener, AutoCloseable {
    private val messages = ArrayBlockingQueue<InteropMessage>(256)
    private val binary = ByteArrayOutputStream()
    private val text = StringBuilder()
    @Volatile private var failed = false
    private val socket = interopAwait(client.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(5))
        .buildAsync(endpoint, this), "guest WebSocket connect")

    override fun onOpen(webSocket: WebSocket) { webSocket.request(1) }

    override fun onBinary(webSocket: WebSocket, data: ByteBuffer, last: Boolean): CompletionStage<*>? {
        if (binary.size() + data.remaining() > 1_048_576) fail(webSocket)
        else {
            val bytes = ByteArray(data.remaining())
            data.get(bytes)
            binary.write(bytes)
            if (last) { offer(webSocket, InteropMessage.Binary(binary.toByteArray())); binary.reset() }
        }
        webSocket.request(1)
        return null
    }

    override fun onText(webSocket: WebSocket, data: CharSequence, last: Boolean): CompletionStage<*>? {
        if (text.length + data.length > 16_384) fail(webSocket)
        else {
            text.append(data)
            if (last) { offer(webSocket, InteropMessage.Text(text.toString())); text.setLength(0) }
        }
        webSocket.request(1)
        return null
    }

    override fun onClose(webSocket: WebSocket, statusCode: Int, reason: String): CompletionStage<*>? {
        offer(webSocket, InteropMessage.Closed(statusCode))
        return null
    }

    override fun onError(webSocket: WebSocket, error: Throwable) { fail(webSocket) }

    private fun fail(webSocket: WebSocket) { failed = true; webSocket.abort() }
    private fun offer(webSocket: WebSocket, message: InteropMessage) { if (!messages.offer(message)) fail(webSocket) }

    fun receive(deadline: Long, label: String): InteropMessage {
        if (failed) throw AssertionError("Guest WebSocket transport failed")
        val remaining = deadline - System.nanoTime()
        if (remaining <= 0) throw AssertionError("Timed out waiting for $label")
        return messages.poll(remaining, TimeUnit.NANOSECONDS)
            ?: throw AssertionError("Timed out waiting for $label")
    }

    fun send(frame: ByteArray) { interopAwait(socket.sendBinary(ByteBuffer.wrap(frame), true), "guest binary send") }
    fun ping() { interopAwait(socket.sendText("ping", true), "guest heartbeat send") }

    override fun close() { socket.abort() }
}

internal class InteropGuest(
    private val socket: InteropSocket,
    private val replay: FrameReplay,
) {
    private val frames = ArrayList<OpenedReplayFrame>()
    private val controls = HashSet<String>()
    private val earlyFrames = ArrayList<ByteArray>()
    private var online = false
    private var closed: Int? = null

    fun send(payload: JsonObject) {
        if (!online || (!replay.isReady() && payload.text("type") != "replay-hello")) {
            throw AssertionError("Guest command sent before trusted handshake")
        }
        socket.send(replay.seal(payload))
    }

    fun awaitControl(type: String) { waitFor(type) { type in controls } }
    fun awaitReady() { waitFor("trusted replay handshake") { replay.isReady() } }
    fun awaitClosed(): Int { waitFor("revoked guest close") { closed != null }; return closed!! }

    fun take(label: String, check: (OpenedReplayFrame) -> Boolean): JsonObject {
        var result: JsonObject? = null
        waitFor(label = label) {
            val index = frames.indexOfFirst(check)
            if (index >= 0) result = frames.removeAt(index).payload
            result != null
        }
        return result!!
    }

    private fun waitFor(label: String, check: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        while (!check()) {
            if (closed != null) throw AssertionError("Guest closed before $label")
            when (val message = socket.receive(deadline, label)) {
                is InteropMessage.Closed -> closed = message.code
                is InteropMessage.Text -> {
                    val type = if (message.value == "pong") "pong" else try {
                        (WireJson.parse(message.value) as? JsonObject)?.text("type")
                    } catch (_: IllegalArgumentException) { throw AssertionError("Invalid relay control") }
                    if (type != null) controls.add(type)
                    if (type == "host-online" || type == "host-offline") {
                        online = type == "host-online"
                        replay.peerReset()
                        hello()
                        if (online) {
                            earlyFrames.forEach(::open)
                            earlyFrames.clear()
                        }
                    }
                }
                is InteropMessage.Binary -> {
                    if (online) open(message.bytes)
                    else {
                        // When host joined first, the relay notifies it before enqueuing host-online
                        // for the guest, so its first hello/catalog can win that race.
                        if ("host-online" in controls || earlyFrames.size >= 16) {
                            throw AssertionError("Unexpected offline fixture frame")
                        }
                        earlyFrames.add(message.bytes)
                    }
                }
            }
            if (replay.isFailed()) throw AssertionError("Kotlin replay failed closed")
        }
    }

    private fun open(frame: ByteArray) {
        val opened = replay.open(frame) { online && closed == null }
            ?: throw AssertionError("Fake host frame was not accepted by Kotlin replay")
        val type = opened.payload.text("type")
        if (!opened.trusted && !isReplayBootstrapResponse(type)) throw AssertionError("Untrusted non-bootstrap response")
        hello()
        if (type != "replay-hello") frames.add(opened)
        if (frames.size > 256) throw AssertionError("Excessive pending fixture frames")
    }

    private fun hello() {
        if (online && replay.takeHello()) socket.send(replay.seal(interopObject("type" to JsonPrimitive("replay-hello"))))
    }
}

internal fun interopObject(vararg fields: Pair<String, JsonElement>): JsonObject = JsonObject(linkedMapOf(*fields))
internal fun JsonObject.text(key: String): String = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    ?: throw AssertionError("Missing string field: $key")
internal fun JsonObject.obj(key: String): JsonObject = this[key] as? JsonObject
    ?: throw AssertionError("Missing object field: $key")
internal fun JsonObject.array(key: String): JsonArray = this[key] as? JsonArray
    ?: throw AssertionError("Missing array field: $key")
internal fun JsonObject.number(key: String): Long = (this[key] as? JsonPrimitive)?.longOrNull
    ?: throw AssertionError("Missing integer field: $key")
internal fun JsonArray.firstObject(): JsonObject = firstOrNull() as? JsonObject
    ?: throw AssertionError("Missing fixture array entry")

internal fun interopDeleteDirectory(directory: Path) {
    // Only the directory created by this test, after every socket/process has stopped.
    Files.walk(directory).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.delete(it) } }
}
